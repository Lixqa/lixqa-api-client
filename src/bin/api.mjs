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
      case 'date':
        return 'Date';
      case 'enum':
        if (def.enum && Array.isArray(def.enum)) {
          const enumValues = def.enum.map((value) => `"${value}"`).join(' | ');
          return enumValues;
        }
        if (def.entries && typeof def.entries === 'object') {
          const enumValues = Object.keys(def.entries)
            .map((key) => `"${key}"`)
            .join(' | ');
          return enumValues;
        }
        return 'string';
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
      maxSize: fileOptions.maxSize || 5242880,
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

  // Process routes
  routes.forEach((route) => {
    const { settings, schema } = route;
    if (settings.disabled) return;

    const availableMethods =
      route.methods && route.methods.length > 0
        ? route.methods
        : Object.keys(schema || {}).filter(
            (method) =>
              method !== 'params' &&
              typeof schema[method] === 'object' &&
              schema[method] !== null,
          );

    if (availableMethods.length === 0) {
      const hasParams = schema?.params && typeof schema.params === 'object';
      if (!hasParams) {
        return;
      } else {
        availableMethods.push('GET');
      }
    }

    route.methods = availableMethods;

    console.log(
      `📝 Generated route: ${route.path} [${availableMethods.join(', ')}]`,
    );
    totalGeneratedRoutes++;
    totalGeneratedMethods += availableMethods.length;
  });

  // Build complete tree structure
  function buildCompleteTree(routes) {
    const tree = {
      static: new Map(),
      params: new Map(),
      methods: new Map(),
    };

    function insertRoute(node, segments, segmentIndex, route) {
      if (segmentIndex >= segments.length) {
        // At leaf - add methods
        route.methods.forEach((method) => {
          if (!route.settings[method]?.disabled) {
            node.methods.set(method, route);
          }
        });
        return;
      }

      const segment = segments[segmentIndex];

      if (segment.startsWith(':')) {
        // Parameter segment
        const paramName = segment.slice(1);
        if (!node.params.has(paramName)) {
          node.params.set(paramName, {
            static: new Map(),
            params: new Map(),
            methods: new Map(),
          });
        }
        insertRoute(node.params.get(paramName), segments, segmentIndex + 1, route);
      } else {
        // Static segment
        if (!node.static.has(segment)) {
          node.static.set(segment, {
            static: new Map(),
            params: new Map(),
            methods: new Map(),
          });
        }
        insertRoute(node.static.get(segment), segments, segmentIndex + 1, route);
      }
    }

    routes.forEach((route) => {
      const segments = route.path.split('/').filter(Boolean);
      insertRoute(tree, segments, 0, route);
    });

    return tree;
  }

  function generateFromTree(node, indent, accumulatedParams = []) {
    let output = '';

    // Generate methods at this level
    node.methods.forEach((route, method) => {
      const methodLower = method.toLowerCase();
      const pathTemplate = route.path.replace(
        /:(\w+)/g,
        (match, paramName) => `\${${paramName}}`,
      );
      output += `${indent}${methodLower}: (requestOptions: any = {}) => ${generateRequestCall(route, method, pathTemplate)},\n`;
    });

    // Generate static children
    node.static.forEach((childNode, name) => {
      output += `${indent}'${name}': {\n`;
      output += generateFromTree(childNode, indent + '  ', accumulatedParams);
      output += `${indent}},\n`;
    });

    // Generate parameterized children
    node.params.forEach((childNode, paramName) => {
      const allParams = [...accumulatedParams, paramName];
      output += `${indent}$: (${paramName}: string | number) => ({\n`;
      output += generateFromTree(childNode, indent + '  ', allParams);
      output += `${indent}}),\n`;
    });

    return output;
  }

  function generateInterfaceFromTree(node, indent, accumulatedParams = []) {
    const signatures = [];

    // Generate method signatures at this level
    node.methods.forEach((route, method) => {
      const methodLower = method.toLowerCase();
      const signature = generateMethodSignature(route, method);
      signatures.push(`${methodLower}: ${signature}`);
    });

    // Generate static children
    node.static.forEach((childNode, name) => {
      const childSigs = generateInterfaceFromTree(childNode, indent + '  ', accumulatedParams);
      if (childSigs) {
        signatures.push(`'${name}': { ${childSigs} }`);
      }
    });

    // Generate parameterized children
    node.params.forEach((childNode, paramName) => {
      const allParams = [...accumulatedParams, paramName];
      const childSigs = generateInterfaceFromTree(childNode, indent + '  ', allParams);
      if (childSigs) {
        signatures.push(`$: (${paramName}: string | number) => { ${childSigs} }`);
      }
    });

    return signatures.join('; ');
  }

  const tree = buildCompleteTree(routes);

  // Generate API implementation
  let apiImpl = 'return {\n';
  apiImpl += generateFromTree(tree, '  ');
  apiImpl += '};';

  // Generate interface
  let apiInterface = 'interface ApiMethods {\n  [key: string]: any;\n';
  const interfaceSig = generateInterfaceFromTree(tree, '  ');
  if (interfaceSig) {
    // Parse and format the flat signature into proper interface structure
    apiInterface += '  ' + interfaceSig.split('; ').join(';\n  ') + ';\n';
  }
  apiInterface += '}\n';

  const generatedCode = `import { createRequest, createClient as createBaseClient } from '${packageJson.name}';

${apiInterface}

const request = createRequest();

const generateApiObject = (requestFn: ReturnType<typeof createRequest>): ApiMethods => {
  ${apiImpl}
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

