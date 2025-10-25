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

  let totalGeneratedRoutes = 0;
  let totalGeneratedMethods = 0;

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
      case 'null':
        return 'null';
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
      case 'union':
        if (!def.options || !Array.isArray(def.options)) return 'any';
        const unionTypes = def.options.map((option) =>
          zodDefToTypeScript(option),
        );
        return unionTypes.join(' | ');
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

  function hasFileUploads(methodSchema) {
    if (!methodSchema || !methodSchema.files) return false;
    const filesDef = methodSchema.files;
    return (
      filesDef &&
      filesDef.def &&
      filesDef.def.type === 'any' &&
      filesDef.__fileOptions
    );
  }

  function getFileUploadInfo(methodSchema) {
    if (!hasFileUploads(methodSchema)) return null;
    const filesDef = methodSchema.files;
    const fileOptions = filesDef.__fileOptions;
    return {
      multiple: fileOptions.multiple || false,
      required: fileOptions.required || false,
      maxFiles: fileOptions.maxFiles || 1,
      allowedExtensions: fileOptions.allowedExtensions || [],
      maxSize: fileOptions.maxSize || 5242880, // 5MB default
    };
  }

  function generateRequestCall(route, method, pathTemplate) {
    const methodSchema = route.schema?.[method] || {};
    const responseType = methodSchema.response
      ? zodDefToTypeScript(methodSchema.response)
      : 'any';

    const hasFiles = hasFileUploads(methodSchema);

    if (hasFiles) {
      const fileInfo = getFileUploadInfo(methodSchema);
      if (fileInfo.multiple) {
        return `requestFn<${responseType}>(\`${pathTemplate}\`, '${method.toUpperCase()}', {
          ...requestOptions,
          files: requestOptions.files ? { files: requestOptions.files } : undefined
        })`;
      } else {
        return `requestFn<${responseType}>(\`${pathTemplate}\`, '${method.toUpperCase()}', {
          ...requestOptions,
          files: requestOptions.file ? { file: requestOptions.file } : undefined
        })`;
      }
    } else {
      return `requestFn<${responseType}>(\`${pathTemplate}\`, '${method.toUpperCase()}', requestOptions)`;
    }
  }

  function generateMethodSignature(route, method) {
    const methodSchema = route.schema?.[method] || {};
    const hasBody = methodSchema.body !== undefined;
    const hasQuery = methodSchema.query !== undefined;
    const hasFiles = hasFileUploads(methodSchema);

    const responseType = methodSchema.response
      ? zodDefToTypeScript(methodSchema.response)
      : 'any';

    if (!hasBody && !hasQuery && !hasFiles)
      return `() => Promise<${responseType}>`;

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

    if (hasFiles) {
      const fileInfo = getFileUploadInfo(methodSchema);
      if (fileInfo.multiple) {
        const filesOptional = fileInfo.required ? '' : '?';
        parts.push(`files${filesOptional}: File[]`);
        if (fileInfo.required) hasRequiredOptions = true;
      } else {
        const fileOptional = fileInfo.required ? '' : '?';
        parts.push(`file${fileOptional}: File`);
        if (fileInfo.required) hasRequiredOptions = true;
      }
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

    // Skip routes with no available methods, unless they have parameter definitions
    // (for routes that are defined but not yet implemented)
    if (availableMethods.length === 0) {
      const hasParams = schema?.params && typeof schema.params === 'object';
      if (!hasParams) {
        return;
      } else {
        // For routes with only params, we'll add a placeholder method
        availableMethods.push('GET'); // Default to GET as placeholder
      }
    }

    // Add methods to route for processing
    route.methods = availableMethods;

    console.log(
      `📝 Generated route: ${route.path} [${availableMethods.join(', ')}]`,
    );
    totalGeneratedRoutes++;
    totalGeneratedMethods += availableMethods.length;

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
        apiObject += `  ${methodLower}: (requestOptions: any = {}) => ${generateRequestCall(rootRoute, method, '/')},\n`;
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
          console.log(
            `  🔧 Generated method: ${methodLower} for route ${route.path}`,
          );
          apiObject += `    ${methodLower}: (requestOptions: any = {}) => ${generateRequestCall(route, method, route.path)},\n`;
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
          apiObject += `    ${methodLower}: (requestOptions: any = {}) => ${generateRequestCall(baseRoute, method, baseRoute.path)},\n`;
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
            apiObject += `      ${methodLower}: (requestOptions: any = {}) => ${generateRequestCall(route, method, route.path)},\n`;
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
          console.log(
            '🔍 API: Processing paramGroup with',
            routes.length,
            'routes:',
            routes.map((r) => r.path),
          );

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

          // Group routes by their static path after the first parameter
          const nestedGroups = new Map();

          routes.forEach((route) => {
            const segments = route.path.split('/').filter(Boolean);
            const remainingSegments = segments.slice(firstParamIndex + 1);

            if (remainingSegments.length === 0) {
              // This is a direct method on the first parameterized route
              if (!nestedGroups.has('__direct__')) {
                nestedGroups.set('__direct__', {
                  routes: [],
                  hasParams: false,
                });
              }
              nestedGroups.get('__direct__').routes.push(route);
            } else {
              // Extract static path before any parameters
              const staticPathSegments = [];
              const paramSegments = [];

              remainingSegments.forEach((segment) => {
                if (segment.startsWith(':')) {
                  paramSegments.push(segment);
                } else {
                  staticPathSegments.push(segment);
                }
              });

              const staticPath = staticPathSegments.join('_');
              const groupKey = staticPath || '__direct__';

              if (!nestedGroups.has(groupKey)) {
                nestedGroups.set(groupKey, {
                  staticPath,
                  hasParams: paramSegments.length > 0,
                  paramSegments,
                  routes: [],
                });
              }
              nestedGroups.get(groupKey).routes.push(route);
            }
          });

          // Generate nested structure
          console.log(
            '🔍 API: nestedGroups keys:',
            Array.from(nestedGroups.keys()),
          );
          nestedGroups.forEach((group, groupKey) => {
            console.log(
              '🔍 API: Processing nestedGroup key:',
              groupKey,
              'with',
              group.routes.length,
              'routes:',
              group.routes.map((r) => r.path),
            );
            if (groupKey === '__direct__') {
              // Direct methods on the first parameterized route
              group.routes.forEach((route) => {
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
                  apiObject += `      ${methodLower}: (requestOptions: any = {}) => ${generateRequestCall(route, method, pathTemplate)},\n`;
                });
              });
            } else {
              // Nested routes
              const {
                staticPath,
                hasParams,
                paramSegments,
                routes: groupRoutes,
              } = group;

              apiObject += `      '${staticPath}': {\n`;

              // Add direct methods (routes without additional parameters)
              const directRoutes = groupRoutes.filter((route) => {
                const segments = route.path.split('/').filter(Boolean);
                const remainingSegments = segments.slice(firstParamIndex + 1);
                const isDirect = !remainingSegments.some((segment) =>
                  segment.startsWith(':'),
                );
                console.log(
                  '🔍 API: Checking route',
                  route.path,
                  'isDirect:',
                  isDirect,
                  'remainingSegments:',
                  remainingSegments,
                );
                return isDirect;
              });
              console.log(
                '🔍 API: directRoutes count:',
                directRoutes.length,
                'paths:',
                directRoutes.map((r) => r.path),
              );

              directRoutes.forEach((route) => {
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
                  apiObject += `        ${methodLower}: (requestOptions: any = {}) => ${generateRequestCall(route, method, pathTemplate)},\n`;
                });
              });

              // Add parameterized methods if there are any
              console.log(
                '🔍 API: hasParams:',
                hasParams,
                'paramSegments:',
                paramSegments,
              );
              if (hasParams && paramSegments.length > 0) {
                const secondParamName = paramSegments[0].slice(1);
                apiObject += `        $: (${secondParamName}: string | number) => ({\n`;

                const paramRoutes = groupRoutes.filter((route) => {
                  const segments = route.path.split('/').filter(Boolean);
                  const remainingSegments = segments.slice(firstParamIndex + 1);
                  const hasParam = remainingSegments.some((segment) =>
                    segment.startsWith(':'),
                  );
                  console.log(
                    '🔍 API: Param route check',
                    route.path,
                    'hasParam:',
                    hasParam,
                  );
                  return hasParam;
                });
                console.log(
                  '🔍 API: paramRoutes count:',
                  paramRoutes.length,
                  'paths:',
                  paramRoutes.map((r) => r.path),
                );

                paramRoutes.forEach((route) => {
                  console.log(
                    '🔍 API: Processing param route',
                    route.path,
                    'methods:',
                    route.methods,
                  );
                  route.methods.forEach((method) => {
                    console.log(
                      '🔍 API: Processing method',
                      method,
                      'disabled:',
                      route.settings[method]?.disabled,
                    );
                    if (route.settings[method]?.disabled) return;
                    const methodLower = method.toLowerCase();
                    const responseType = route.schema?.[method]?.response
                      ? zodDefToTypeScript(route.schema[method].response)
                      : 'any';
                    const pathTemplate = route.path.replace(
                      /:(\w+)/g,
                      (match, paramName) => `\${${paramName}}`,
                    );
                    console.log(
                      '🔍 API: Generating method',
                      methodLower,
                      'for',
                      route.path,
                    );
                    apiObject += `          ${methodLower}: (requestOptions: any = {}) => ${generateRequestCall(route, method, pathTemplate)},\n`;
                  });
                });

                apiObject += `        }),\n`;
              }

              apiObject += `      },\n`;
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
          console.log(
            `  🔧 Generated method: ${methodLower} for route ${route.path}`,
          );
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
        console.log(
          `  🔧 Generated parameterized route: ${route.path} with params [${paramNames.join(', ')}]`,
        );
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
          console.log(
            `    🔧 Generated method: ${methodLower} for parameterized route ${route.path}`,
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

          // Group routes by their static path after the first parameter
          const nestedGroups = new Map();

          routes.forEach((route) => {
            const segments = route.path.split('/').filter(Boolean);
            const remainingSegments = segments.slice(firstParamIndex + 1);

            if (remainingSegments.length === 0) {
              // This is a direct method on the first parameterized route
              if (!nestedGroups.has('__direct__')) {
                nestedGroups.set('__direct__', {
                  routes: [],
                  hasParams: false,
                });
              }
              nestedGroups.get('__direct__').routes.push(route);
            } else {
              // Extract static path before any parameters
              const staticPathSegments = [];
              const paramSegments = [];

              remainingSegments.forEach((segment) => {
                if (segment.startsWith(':')) {
                  paramSegments.push(segment);
                } else {
                  staticPathSegments.push(segment);
                }
              });

              const staticPath = staticPathSegments.join('_');
              const groupKey = staticPath || '__direct__';

              if (!nestedGroups.has(groupKey)) {
                nestedGroups.set(groupKey, {
                  staticPath,
                  hasParams: paramSegments.length > 0,
                  paramSegments,
                  routes: [],
                });
              }
              nestedGroups.get(groupKey).routes.push(route);
            }
          });

          // Generate interface for nested structure
          let paramInterface = `$: (${firstParamName}: string | number) => { `;
          const paramMethods = [];

          nestedGroups.forEach((group, groupKey) => {
            if (groupKey === '__direct__') {
              // Direct methods on the first parameterized route
              group.routes.forEach((route) => {
                route.methods.forEach((method) => {
                  if (route.settings[method]?.disabled) return;
                  const methodLower = method.toLowerCase();
                  const signature = generateMethodSignature(route, method);
                  paramMethods.push(`${methodLower}: ${signature}`);
                });
              });
            } else {
              // Nested routes
              const {
                staticPath,
                hasParams,
                paramSegments,
                routes: groupRoutes,
              } = group;

              const nestedMethods = [];

              // Add direct methods (routes without additional parameters)
              const directRoutes = groupRoutes.filter((route) => {
                const segments = route.path.split('/').filter(Boolean);
                const remainingSegments = segments.slice(firstParamIndex + 1);
                return !remainingSegments.some((segment) =>
                  segment.startsWith(':'),
                );
              });

              directRoutes.forEach((route) => {
                route.methods.forEach((method) => {
                  if (route.settings[method]?.disabled) return;
                  const methodLower = method.toLowerCase();
                  const signature = generateMethodSignature(route, method);
                  nestedMethods.push(`${methodLower}: ${signature}`);
                });
              });

              // Add parameterized methods if there are any
              if (hasParams && paramSegments.length > 0) {
                const secondParamName = paramSegments[0].slice(1);

                const paramRoutes = groupRoutes.filter((route) => {
                  const segments = route.path.split('/').filter(Boolean);
                  const remainingSegments = segments.slice(firstParamIndex + 1);
                  return remainingSegments.some((segment) =>
                    segment.startsWith(':'),
                  );
                });

                const paramRouteMethods = [];
                paramRoutes.forEach((route) => {
                  route.methods.forEach((method) => {
                    if (route.settings[method]?.disabled) return;
                    const methodLower = method.toLowerCase();
                    const signature = generateMethodSignature(route, method);
                    paramRouteMethods.push(`${methodLower}: ${signature}`);
                  });
                });

                nestedMethods.push(
                  `$: (${secondParamName}: string | number) => { ${paramRouteMethods.join('; ')} }`,
                );
              }

              paramMethods.push(
                `'${staticPath}': { ${nestedMethods.join('; ')} }`,
              );
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

  console.log(`\n📊 Generation Summary:`);
  console.log(`  • Total routes processed: ${totalGeneratedRoutes}`);
  console.log(`  • Total methods generated: ${totalGeneratedMethods}`);
  console.log(`  • Static routes: ${staticRoutes.length}`);
  console.log(`  • Parameterized routes: ${parameterizedRoutes.length}`);
  console.log(`\nWriting API client to ${OUTPUT}...`);

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
