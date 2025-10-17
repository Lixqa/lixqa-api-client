#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import prettier from 'prettier';
import packageJson from '../../package.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('lixqa-api')
  .description('Generate TypeScript API client from Lixqa API schema')
  .version(packageJson.version);

program
  .command('generate')
  .description('Generate TypeScript API client from API schema')
  .option('-u, --url <url>', 'API base URL', 'http://localhost:3000')
  .option(
    '-o, --output <path>',
    'Output file path',
    './generated/api-client.ts',
  )
  .option('--no-format', 'Skip code formatting')
  .action(async (options) => {
    await generateClient(options);
  });

program.parse();

async function generateClient(options) {
  const API_BASE = options.url;
  const OUTPUT = options.output;

  console.log(`Fetching API schema from ${API_BASE}...`);
  let routes;
  try {
    const res = await fetch(`${API_BASE}/__client__`);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();
    routes = data.data || data;
    console.log(`Found ${routes.length} routes`);
  } catch (error) {
    console.error('❌ Failed to fetch API schema:', error.message);
    process.exit(1);
  }

  function zodDefToTypeScript(zodDef, isOptional = false) {
    if (!zodDef || !zodDef.def) return 'any';
    const def = zodDef.def;
    switch (def.type) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'any':
        return 'any';
      case 'never':
        return 'never';
      case 'optional':
        return zodDefToTypeScript(def.innerType, true);
      case 'array':
        const elementType = def.element
          ? zodDefToTypeScript(def.element)
          : 'any';
        return `${elementType}[]`;
      case 'object':
        if (!def.shape) return 'Record<string, any>';
        const props = Object.entries(def.shape)
          .map(([key, value]) => {
            const type = zodDefToTypeScript(value);
            const optional = value.def?.type === 'optional' ? '?' : '';
            return `${key}${optional}: ${type}`;
          })
          .join('; ');
        return `{ ${props} }`;
      case 'void':
        return 'void';
      default:
        return 'any';
    }
  }

  function pathToMethodName(path) {
    return (
      path
        .replace(/^\//, '')
        .replace(/\//g, '_')
        .replace(/:(\w+)/g, '')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || 'root'
    );
  }

  function hasParameters(path) {
    return path.includes(':');
  }

  function getParameterNames(path) {
    const matches = path.match(/:(\w+)/g);
    return matches ? matches.map((match) => match.slice(1)) : [];
  }

  function hasRequiredFields(zodDef) {
    if (!zodDef || !zodDef.def) return false;
    const def = zodDef.def;
    if (def.type === 'object' && def.shape) {
      return Object.values(def.shape).some(
        (field) => field.def?.type !== 'optional',
      );
    }
    return true;
  }

  function generateMethodSignature(route, method) {
    const methodSchema = route.schema?.[method] || {};
    const hasBody = methodSchema.body !== undefined;
    const hasQuery = methodSchema.query !== undefined;

    const responseType = methodSchema.response
      ? zodDefToTypeScript(methodSchema.response)
      : 'any';

    if (!hasBody && !hasQuery) return `() => Promise<${responseType}>`;

    const parts = [];
    let hasRequiredOptions = false;

    if (hasBody) {
      const bodyType = zodDefToTypeScript(methodSchema.body);
      const bodyRequired =
        bodyType !== 'any' && hasRequiredFields(methodSchema.body);
      const bodyOptional = bodyRequired ? '' : '?';
      parts.push(`body${bodyOptional}: ${bodyType}`);
      if (bodyRequired) hasRequiredOptions = true;
    }

    if (hasQuery) {
      const queryType = zodDefToTypeScript(methodSchema.query);
      const queryRequired =
        queryType !== 'any' && hasRequiredFields(methodSchema.query);
      const queryOptional = queryRequired ? '' : '?';
      parts.push(`query${queryOptional}: ${queryType}`);
      if (queryRequired) hasRequiredOptions = true;
    }

    const optionsRequired = hasRequiredOptions ? '' : '?';
    return `(options${optionsRequired}: { ${parts.join('; ')} }) => Promise<${responseType}>`;
  }

  const staticRoutes = [];
  const parameterizedRoutes = [];

  routes.forEach((route) => {
    const { settings, schema } = route;
    if (settings.disabled) return;

    // Extract methods from schema if methods array is empty
    const availableMethods =
      route.methods && route.methods.length > 0
        ? route.methods
        : Object.keys(schema || {}).filter(
            (method) =>
              method !== 'params' &&
              typeof schema[method] === 'object' &&
              schema[method] !== null,
          );

    // Skip routes with no available methods
    if (availableMethods.length === 0) return;

    // Add methods to route for processing
    route.methods = availableMethods;

    if (hasParameters(route.path)) {
      parameterizedRoutes.push(route);
    } else {
      staticRoutes.push(route);
    }
  });

  // Generate API object for createClient function
  function generateApiObjectForClient() {
    let apiObject = 'return {\n';

    // Add root methods first
    const rootRoute = staticRoutes.find((route) => route.path === '/');
    if (rootRoute) {
      rootRoute.methods.forEach((method) => {
        if (rootRoute.settings[method]?.disabled) return;
        const methodLower = method.toLowerCase();
        const responseType = rootRoute.schema?.[method]?.response
          ? zodDefToTypeScript(rootRoute.schema[method].response)
          : 'any';
        apiObject += `  ${methodLower}: (requestOptions: any = {}) => requestFn<${responseType}>('/', '${method.toUpperCase()}', requestOptions),\n`;
      });
    }

    // Group routes by their base path for nested structure
    const routeGroups = new Map();

    // Group static routes
    staticRoutes.forEach((route) => {
      if (route.path === '/') return; // Skip root, already handled

      const segments = route.path.split('/').filter(Boolean);
      const basePath = segments[0];

      if (!routeGroups.has(basePath)) {
        routeGroups.set(basePath, {
          static: [],
          parameterized: [],
        });
      }

      routeGroups.get(basePath).static.push(route);
    });

    // Group parameterized routes
    parameterizedRoutes.forEach((route) => {
      const segments = route.path.split('/').filter(Boolean);
      const basePath = segments[0];

      if (!routeGroups.has(basePath)) {
        routeGroups.set(basePath, {
          static: [],
          parameterized: [],
        });
      }

      routeGroups.get(basePath).parameterized.push(route);
    });

    // Generate each group
    routeGroups.forEach((routes, basePath) => {
      const { static: staticRoutes, parameterized: paramRoutes } = routes;

      // Check if we have a base route (exact match with basePath)
      const baseRoute = staticRoutes.find(
        (route) => route.path === `/${basePath}`,
      );

      // If only one static route with no nested paths and no parameterized routes, make it flat
      if (staticRoutes.length === 1 && paramRoutes.length === 0 && baseRoute) {
        const route = staticRoutes[0];
        const methods = route.methods.filter(
          (method) => !route.settings[method]?.disabled,
        );
        if (methods.length === 0) return; // Skip routes with no methods

        apiObject += `  '${basePath}': {\n`;
        methods.forEach((method) => {
          const methodLower = method.toLowerCase();
          const responseType = route.schema?.[method]?.response
            ? zodDefToTypeScript(route.schema[method].response)
            : 'any';
          apiObject += `    ${methodLower}: (requestOptions: any = {}) => requestFn<${responseType}>('${route.path}', '${method.toUpperCase()}', requestOptions),\n`;
        });
        apiObject += '  },\n';
        return;
      }

      // Multi-level or parameterized routes - create nested structure
      apiObject += `  '${basePath}': {\n`;

      // Add base route methods if it exists
      if (baseRoute) {
        baseRoute.methods.forEach((method) => {
          if (baseRoute.settings[method]?.disabled) return;
          const methodLower = method.toLowerCase();
          const responseType = baseRoute.schema?.[method]?.response
            ? zodDefToTypeScript(baseRoute.schema[method].response)
            : 'any';
          apiObject += `    ${methodLower}: (requestOptions: any = {}) => requestFn<${responseType}>('${baseRoute.path}', '${method.toUpperCase()}', requestOptions),\n`;
        });
      }

      // Add nested static routes
      staticRoutes.forEach((route) => {
        const segments = route.path.split('/').filter(Boolean);
        const remainingPath = segments.slice(1);

        if (remainingPath.length > 0) {
          // This is a nested route
          const methods = route.methods.filter(
            (method) => !route.settings[method]?.disabled,
          );
          if (methods.length === 0) return; // Skip routes with no methods

          const nestedName = remainingPath.join('_');
          apiObject += `    '${nestedName}': {\n`;
          methods.forEach((method) => {
            const methodLower = method.toLowerCase();
            const responseType = route.schema?.[method]?.response
              ? zodDefToTypeScript(route.schema[method].response)
              : 'any';
            apiObject += `      ${methodLower}: (requestOptions: any = {}) => requestFn<${responseType}>('${route.path}', '${method.toUpperCase()}', requestOptions),\n`;
          });
          apiObject += '    },\n';
        }
      });

      // Add parameterized routes
      if (paramRoutes.length > 0) {
        // Group parameterized routes by their base path
        const paramGroups = new Map();

        paramRoutes.forEach((route) => {
          const segments = route.path.split('/').filter(Boolean);
          const basePath = segments[0]; // e.g., 'organisations'

          if (!paramGroups.has(basePath)) {
            paramGroups.set(basePath, []);
          }
          paramGroups.get(basePath).push(route);
        });

        // Generate parameterized route groups
        paramGroups.forEach((routes) => {
          // Find the first parameter position
          const firstParamRoute = routes.find((route) => {
            const segments = route.path.split('/').filter(Boolean);
            return segments.some((segment) => segment.startsWith(':'));
          });

          if (!firstParamRoute) return;

          const firstParamSegments = firstParamRoute.path
            .split('/')
            .filter(Boolean);
          const firstParamIndex = firstParamSegments.findIndex((segment) =>
            segment.startsWith(':'),
          );
          const firstParamName = firstParamSegments[firstParamIndex].slice(1);

          apiObject += `    $: (${firstParamName}: string | number) => ({\n`;

          // Group routes by their structure after the first parameter
          const nestedGroups = new Map();

          routes.forEach((route) => {
            const segments = route.path.split('/').filter(Boolean);
            const remainingSegments = segments.slice(firstParamIndex + 1);

            if (remainingSegments.length === 0) {
              // This is a direct method on the first parameterized route
              if (!nestedGroups.has('__direct__')) {
                nestedGroups.set('__direct__', []);
              }
              nestedGroups.get('__direct__').push(route);
            } else {
              // This is a nested route
              const nestedPath = remainingSegments.join('_');
              if (!nestedGroups.has(nestedPath)) {
                nestedGroups.set(nestedPath, []);
              }
              nestedGroups.get(nestedPath).push(route);
            }
          });

          // Generate nested structure
          nestedGroups.forEach((groupRoutes, nestedPath) => {
            if (nestedPath === '__direct__') {
              // Direct methods on the first parameterized route
              groupRoutes.forEach((route) => {
                route.methods.forEach((method) => {
                  if (route.settings[method]?.disabled) return;
                  const methodLower = method.toLowerCase();
                  const responseType = route.schema?.[method]?.response
                    ? zodDefToTypeScript(route.schema[method].response)
                    : 'any';
                  const pathTemplate = route.path.replace(
                    /:(\w+)/g,
                    (match, paramName) => `\${${paramName}}`,
                  );
                  apiObject += `      ${methodLower}: (requestOptions: any = {}) => requestFn<${responseType}>(\`${pathTemplate}\`, '${method.toUpperCase()}', requestOptions),\n`;
                });
              });
            } else {
              // Nested routes - check if they have more parameters
              const hasMoreParams = groupRoutes.some((route) => {
                const segments = route.path.split('/').filter(Boolean);
                const remainingSegments = segments.slice(firstParamIndex + 1);
                return remainingSegments.some((segment) =>
                  segment.startsWith(':'),
                );
              });

              if (hasMoreParams) {
                // This nested route has more parameters, create another $ function
                const secondParamRoute = groupRoutes.find((route) => {
                  const segments = route.path.split('/').filter(Boolean);
                  const remainingSegments = segments.slice(firstParamIndex + 1);
                  return remainingSegments.some((segment) =>
                    segment.startsWith(':'),
                  );
                });

                if (secondParamRoute) {
                  const secondParamSegments = secondParamRoute.path
                    .split('/')
                    .filter(Boolean);
                  const remainingSegments = secondParamSegments.slice(
                    firstParamIndex + 1,
                  );
                  const secondParamIndex = remainingSegments.findIndex(
                    (segment) => segment.startsWith(':'),
                  );
                  const secondParamName =
                    remainingSegments[secondParamIndex].slice(1);

                  // Extract the static path before the parameter
                  const staticPath = remainingSegments
                    .slice(0, secondParamIndex)
                    .join('_');

                  apiObject += `      '${staticPath}': {\n`;
                  apiObject += `        $: (${secondParamName}: string | number) => ({\n`;

                  groupRoutes.forEach((route) => {
                    route.methods.forEach((method) => {
                      if (route.settings[method]?.disabled) return;
                      const methodLower = method.toLowerCase();
                      const responseType = route.schema?.[method]?.response
                        ? zodDefToTypeScript(route.schema[method].response)
                        : 'any';
                      const pathTemplate = route.path.replace(
                        /:(\w+)/g,
                        (match, paramName) => `\${${paramName}}`,
                      );
                      apiObject += `          ${methodLower}: (requestOptions: any = {}) => requestFn<${responseType}>(\`${pathTemplate}\`, '${method.toUpperCase()}', requestOptions),\n`;
                    });
                  });

                  apiObject += `        }),\n`;
                  apiObject += `      },\n`;
                }
              } else {
                // This nested route has no more parameters, just methods
                apiObject += `      '${nestedPath}': {\n`;
                groupRoutes.forEach((route) => {
                  route.methods.forEach((method) => {
                    if (route.settings[method]?.disabled) return;
                    const methodLower = method.toLowerCase();
                    const responseType = route.schema?.[method]?.response
                      ? zodDefToTypeScript(route.schema[method].response)
                      : 'any';
                    const pathTemplate = route.path.replace(
                      /:(\w+)/g,
                      (match, paramName) => `\${${paramName}}`,
                    );
                    apiObject += `        ${methodLower}: (requestOptions: any = {}) => requestFn<${responseType}>(\`${pathTemplate}\`, '${method.toUpperCase()}', requestOptions),\n`;
                  });
                });
                apiObject += `      },\n`;
              }
            }
          });

          apiObject += '    }),\n';
        });
      }

      apiObject += '  },\n';
    });

    apiObject += '};';
    return apiObject;
  }

  // Generate clean API object structure dynamically
  function generateApiObject() {
    let apiObject = 'export const api: ApiMethods = {\n';

    // Add root methods first
    const rootRoute = staticRoutes.find((route) => route.path === '/');
    if (rootRoute) {
      rootRoute.methods.forEach((method) => {
        if (rootRoute.settings[method]?.disabled) return;
        const methodLower = method.toLowerCase();
        const responseType = rootRoute.schema?.[method]?.response
          ? zodDefToTypeScript(rootRoute.schema[method].response)
          : 'any';
        apiObject += `  ${methodLower}: (options: any = {}) => request<${responseType}>('/', '${method.toUpperCase()}', options),\n`;
      });
    }

    // Group routes by their base path for nested structure
    const routeGroups = new Map();

    // Group static routes
    staticRoutes.forEach((route) => {
      if (route.path === '/') return; // Skip root, already handled

      const segments = route.path.split('/').filter(Boolean);
      const basePath = segments[0];

      if (!routeGroups.has(basePath)) {
        routeGroups.set(basePath, {
          static: [],
          parameterized: [],
        });
      }

      routeGroups.get(basePath).static.push(route);
    });

    // Group parameterized routes
    parameterizedRoutes.forEach((route) => {
      const segments = route.path.split('/').filter(Boolean);
      const basePath = segments[0];

      if (!routeGroups.has(basePath)) {
        routeGroups.set(basePath, {
          static: [],
          parameterized: [],
        });
      }

      routeGroups.get(basePath).parameterized.push(route);
    });

    // Generate each group
    routeGroups.forEach((routes, basePath) => {
      const { static: staticRoutes, parameterized: paramRoutes } = routes;

      // Check if we have a base route (exact match with basePath)
      const baseRoute = staticRoutes.find(
        (route) => route.path === `/${basePath}`,
      );

      // If only one static route with no nested paths and no parameterized routes, make it flat
      if (staticRoutes.length === 1 && paramRoutes.length === 0 && baseRoute) {
        const route = staticRoutes[0];
        const methods = route.methods.filter(
          (method) => !route.settings[method]?.disabled,
        );
        if (methods.length === 0) return; // Skip routes with no methods

        apiObject += `  '${basePath}': {\n`;
        methods.forEach((method) => {
          const methodLower = method.toLowerCase();
          const responseType = route.schema?.[method]?.response
            ? zodDefToTypeScript(route.schema[method].response)
            : 'any';
          apiObject += `    ${methodLower}: (options: any = {}) => request<${responseType}>('${route.path}', '${method.toUpperCase()}', options),\n`;
        });
        apiObject += '  },\n';
        return;
      }

      // Multi-level or parameterized routes - create nested structure
      apiObject += `  '${basePath}': {\n`;

      // Add base route methods if it exists
      if (baseRoute) {
        baseRoute.methods.forEach((method) => {
          if (baseRoute.settings[method]?.disabled) return;
          const methodLower = method.toLowerCase();
          const responseType = baseRoute.schema?.[method]?.response
            ? zodDefToTypeScript(baseRoute.schema[method].response)
            : 'any';
          apiObject += `    ${methodLower}: (options: any = {}) => request<${responseType}>('${baseRoute.path}', '${method.toUpperCase()}', options),\n`;
        });
      }

      // Add nested static routes
      staticRoutes.forEach((route) => {
        const segments = route.path.split('/').filter(Boolean);
        const remainingPath = segments.slice(1);

        if (remainingPath.length > 0) {
          // This is a nested route
          const methods = route.methods.filter(
            (method) => !route.settings[method]?.disabled,
          );
          if (methods.length === 0) return; // Skip routes with no methods

          const nestedName = remainingPath.join('_');
          apiObject += `    '${nestedName}': {\n`;
          methods.forEach((method) => {
            const methodLower = method.toLowerCase();
            const responseType = route.schema?.[method]?.response
              ? zodDefToTypeScript(route.schema[method].response)
              : 'any';
            apiObject += `      ${methodLower}: (options: any = {}) => request<${responseType}>('${route.path}', '${method.toUpperCase()}', options),\n`;
          });
          apiObject += '    },\n';
        }
      });

      // Add parameterized routes
      paramRoutes.forEach((route) => {
        const paramNames = getParameterNames(route.path);
        apiObject += `    $: (${paramNames.map((name) => `${name}: string | number`).join(', ')}) => ({\n`;
        route.methods.forEach((method) => {
          if (route.settings[method]?.disabled) return;
          const methodLower = method.toLowerCase();
          const responseType = route.schema?.[method]?.response
            ? zodDefToTypeScript(route.schema[method].response)
            : 'any';
          const pathTemplate = route.path.replace(
            /:(\w+)/g,
            (match, paramName) => `\${${paramName}}`,
          );
          apiObject += `      ${methodLower}: (options: any = {}) => request<${responseType}>(\`${pathTemplate}\`, '${method.toUpperCase()}', options),\n`;
        });
        apiObject += '    }),\n';
      });

      apiObject += '  },\n';
    });

    apiObject += '};\n';
    return apiObject;
  }

  // Generate interface dynamically
  function generateInterface() {
    let apiInterface = 'interface ApiMethods {\n  [key: string]: any;\n';

    // Group routes by their base path for nested structure (same logic as API object)
    const routeGroups = new Map();

    // Add root methods first
    const rootRoute = staticRoutes.find((route) => route.path === '/');
    if (rootRoute) {
      rootRoute.methods.forEach((method) => {
        if (rootRoute.settings[method]?.disabled) return;
        const methodLower = method.toLowerCase();
        const signature = generateMethodSignature(rootRoute, method);
        apiInterface += `  ${methodLower}: ${signature};\n`;
      });
    }

    // Group all other routes by their base path
    staticRoutes.forEach((route) => {
      if (route.path === '/') return; // Skip root, already handled

      const segments = route.path.split('/').filter(Boolean);
      const basePath = segments[0];

      if (!routeGroups.has(basePath)) {
        routeGroups.set(basePath, {
          static: [],
          parameterized: [],
        });
      }

      routeGroups.get(basePath).static.push(route);
    });

    // Add parameterized routes to their groups
    parameterizedRoutes.forEach((route) => {
      const segments = route.path.split('/').filter(Boolean);
      const basePath = segments[0];

      if (!routeGroups.has(basePath)) {
        routeGroups.set(basePath, {
          static: [],
          parameterized: [],
        });
      }

      routeGroups.get(basePath).parameterized.push(route);
    });

    // Generate interface for each group
    routeGroups.forEach((routes, basePath) => {
      const { static: staticRoutes, parameterized: paramRoutes } = routes;

      // If only one static route with no nested paths, make it flat
      if (staticRoutes.length === 1 && paramRoutes.length === 0) {
        const route = staticRoutes[0];
        const segments = route.path.split('/').filter(Boolean);

        if (segments.length === 1) {
          // Single level route - make it flat
          const methods = route.methods.filter(
            (method) => !route.settings[method]?.disabled,
          );
          if (methods.length === 0) return; // Skip routes with no methods

          const routeName = segments[0];
          const methodSigs = [];
          methods.forEach((method) => {
            const methodLower = method.toLowerCase();
            const signature = generateMethodSignature(route, method);
            methodSigs.push(`${methodLower}: ${signature}`);
          });
          apiInterface += `  '${routeName}': { ${methodSigs.join('; ')} };\n`;
          return;
        }
      }

      // Multi-level or parameterized routes - create nested structure
      let groupInterface = `  '${basePath}': {`;
      const groupMethods = [];

      // Add static routes at this level
      staticRoutes.forEach((route) => {
        const segments = route.path.split('/').filter(Boolean);
        const remainingPath = segments.slice(1);

        if (remainingPath.length === 0) {
          // This is the base route itself
          route.methods.forEach((method) => {
            if (route.settings[method]?.disabled) return;
            const methodLower = method.toLowerCase();
            const signature = generateMethodSignature(route, method);
            groupMethods.push(`${methodLower}: ${signature}`);
          });
        } else {
          // This is a nested route
          const nestedName = remainingPath.join('_');
          const nestedMethods = [];
          route.methods.forEach((method) => {
            if (route.settings[method]?.disabled) return;
            const methodLower = method.toLowerCase();
            const signature = generateMethodSignature(route, method);
            nestedMethods.push(`${methodLower}: ${signature}`);
          });
          groupMethods.push(`'${nestedName}': { ${nestedMethods.join('; ')} }`);
        }
      });

      // Add parameterized routes
      if (paramRoutes.length > 0) {
        // Group parameterized routes by their base path
        const paramGroups = new Map();

        paramRoutes.forEach((route) => {
          const segments = route.path.split('/').filter(Boolean);
          const basePath = segments[0]; // e.g., 'organisations'

          if (!paramGroups.has(basePath)) {
            paramGroups.set(basePath, []);
          }
          paramGroups.get(basePath).push(route);
        });

        // Generate parameterized route groups
        paramGroups.forEach((routes) => {
          // Find the first parameter position
          const firstParamRoute = routes.find((route) => {
            const segments = route.path.split('/').filter(Boolean);
            return segments.some((segment) => segment.startsWith(':'));
          });

          if (!firstParamRoute) return;

          const firstParamSegments = firstParamRoute.path
            .split('/')
            .filter(Boolean);
          const firstParamIndex = firstParamSegments.findIndex((segment) =>
            segment.startsWith(':'),
          );
          const firstParamName = firstParamSegments[firstParamIndex].slice(1);

          // Group routes by their structure after the first parameter
          const nestedGroups = new Map();

          routes.forEach((route) => {
            const segments = route.path.split('/').filter(Boolean);
            const remainingSegments = segments.slice(firstParamIndex + 1);

            if (remainingSegments.length === 0) {
              // This is a direct method on the first parameterized route
              if (!nestedGroups.has('__direct__')) {
                nestedGroups.set('__direct__', []);
              }
              nestedGroups.get('__direct__').push(route);
            } else {
              // This is a nested route
              const nestedPath = remainingSegments.join('_');
              if (!nestedGroups.has(nestedPath)) {
                nestedGroups.set(nestedPath, []);
              }
              nestedGroups.get(nestedPath).push(route);
            }
          });

          // Generate interface for nested structure
          let paramInterface = `$: (${firstParamName}: string | number) => { `;
          const paramMethods = [];

          nestedGroups.forEach((groupRoutes, nestedPath) => {
            if (nestedPath === '__direct__') {
              // Direct methods on the first parameterized route
              groupRoutes.forEach((route) => {
                route.methods.forEach((method) => {
                  if (route.settings[method]?.disabled) return;
                  const methodLower = method.toLowerCase();
                  const signature = generateMethodSignature(route, method);
                  paramMethods.push(`${methodLower}: ${signature}`);
                });
              });
            } else {
              // Nested routes - check if they have more parameters
              const hasMoreParams = groupRoutes.some((route) => {
                const segments = route.path.split('/').filter(Boolean);
                const remainingSegments = segments.slice(firstParamIndex + 1);
                return remainingSegments.some((segment) =>
                  segment.startsWith(':'),
                );
              });

              if (hasMoreParams) {
                // This nested route has more parameters, create another $ function
                const secondParamRoute = groupRoutes.find((route) => {
                  const segments = route.path.split('/').filter(Boolean);
                  const remainingSegments = segments.slice(firstParamIndex + 1);
                  return remainingSegments.some((segment) =>
                    segment.startsWith(':'),
                  );
                });

                if (secondParamRoute) {
                  const secondParamSegments = secondParamRoute.path
                    .split('/')
                    .filter(Boolean);
                  const remainingSegments = secondParamSegments.slice(
                    firstParamIndex + 1,
                  );
                  const secondParamIndex = remainingSegments.findIndex(
                    (segment) => segment.startsWith(':'),
                  );
                  const secondParamName =
                    remainingSegments[secondParamIndex].slice(1);

                  // Extract the static path before the parameter
                  const staticPath = remainingSegments
                    .slice(0, secondParamIndex)
                    .join('_');

                  const nestedMethods = [];
                  groupRoutes.forEach((route) => {
                    route.methods.forEach((method) => {
                      if (route.settings[method]?.disabled) return;
                      const methodLower = method.toLowerCase();
                      const signature = generateMethodSignature(route, method);
                      nestedMethods.push(`${methodLower}: ${signature}`);
                    });
                  });

                  paramMethods.push(
                    `'${staticPath}': { $: (${secondParamName}: string | number) => { ${nestedMethods.join('; ')} } }`,
                  );
                }
              } else {
                // This nested route has no more parameters, just methods
                const nestedMethods = [];
                groupRoutes.forEach((route) => {
                  route.methods.forEach((method) => {
                    if (route.settings[method]?.disabled) return;
                    const methodLower = method.toLowerCase();
                    const signature = generateMethodSignature(route, method);
                    nestedMethods.push(`${methodLower}: ${signature}`);
                  });
                });
                paramMethods.push(
                  `'${nestedPath}': { ${nestedMethods.join('; ')} }`,
                );
              }
            }
          });

          paramInterface += `${paramMethods.join('; ')} }`;
          groupMethods.push(paramInterface);
        });
      }

      groupInterface += ` ${groupMethods.join('; ')} };\n`;
      apiInterface += groupInterface;
    });

    apiInterface += '}\n';
    return apiInterface;
  }

  const apiInterface = generateInterface();

  const generatedCode = `import { createRequest, createClient as createBaseClient } from '${packageJson.name}';

${apiInterface}

const request = createRequest();

const generateApiObject = (requestFn: ReturnType<typeof createRequest>): ApiMethods => {
  ${generateApiObjectForClient()}
};

export const createClient = createBaseClient(generateApiObject);

export const api: ApiMethods = generateApiObject(request);`;

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Writing API client to ${OUTPUT}...`);

  if (options.format) {
    try {
      const formatted = await prettier.format(generatedCode, {
        parser: 'typescript',
        semi: true,
        singleQuote: true,
        trailingComma: 'es5',
        printWidth: 120,
        tabWidth: 2,
      });
      fs.writeFileSync(OUTPUT, formatted);
      console.log('✅ API client generated and formatted successfully!');
    } catch (error) {
      console.log(
        '⚠️  API client generated but formatting failed:',
        error.message,
      );
      fs.writeFileSync(OUTPUT, generatedCode);
      console.log('✅ Raw API client written successfully!');
    }
  } else {
    fs.writeFileSync(OUTPUT, generatedCode);
    console.log('✅ API client generated successfully!');
  }
}
