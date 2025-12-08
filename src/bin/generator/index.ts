/**
 * Main API client generator
 * Orchestrates the generation of TypeScript API client code from API schema
 */

import fs from 'fs';
import path from 'path';
import prettier from 'prettier';
import packageJson from '../../../package.json' with { type: 'json' };

import { createLogger } from './logger.js';
import { fetchApiSchema, type Route } from './fetch-schema.js';
import { processRoutes, buildCompleteTree } from './tree-builder.js';
import {
  generateFromTree,
  generateInterfaceFromTree,
  collectTypesFromTree,
} from './code-generator.js';
import {
  collectRouteTypesV2,
  generateRouteTypeMapCode,
} from './type-generator-v2.js';

/**
 * Generator options
 */
export interface GeneratorOptions {
  url: string;
  output: string;
  debug?: boolean;
  separateTypes?: boolean;
  useTypesV2?: boolean;
  format?: boolean;
}

/**
 * Generates the complete TypeScript API client code
 * @param options - Generator options
 */
export async function generateClient(options: GeneratorOptions): Promise<void> {
  const API_BASE = options.url;
  const OUTPUT = options.output;
  const DEBUG = options.debug ?? false;
  const SEPARATE_TYPES = options.separateTypes || false;
  const USE_TYPES_V2 = options.useTypesV2 || false;

  // Validate: useTypesV2 requires separateTypes
  if (USE_TYPES_V2 && !SEPARATE_TYPES) {
    throw new Error('--use-types-v2 requires --separate-types to be enabled');
  }

  const log = createLogger(DEBUG);

  // Fetch API schema
  let routes: Route[];
  try {
    routes = await fetchApiSchema(API_BASE, log);
  } catch (error) {
    process.exit(1);
  }

  // Process routes to extract methods
  const {
    routes: processedRoutes,
    totalGeneratedRoutes,
    totalGeneratedMethods,
  } = processRoutes(routes, log);

  // Build route tree
  log.debug('Building route tree...');
  const tree = buildCompleteTree(processedRoutes);

  // Collect types if separate-types is enabled
  let typeDefinitions = new Map<string, { name: string; type: string }>();
  let routeTypeMapCode = '';
  let routeTypeHelperCode = '';

  if (USE_TYPES_V2) {
    // Use v2 type generation
    log.debug('Collecting route types (v2)...');
    const routeTypeMap = collectRouteTypesV2(tree, [], {}, '', log);
    routeTypeMapCode = generateRouteTypeMapCode(routeTypeMap);

    // RouteType helper code (embedded to avoid file system issues in dist)
    routeTypeHelperCode = `export type RouteTypePart = 'RequestBody' | 'ResponseBody' | 'RequestQuery' | 'Params';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type RoutePath = keyof RouteTypeMap & string;

export type RouteMethods<P extends RoutePath> = P extends keyof RouteTypeMap
  ? keyof RouteTypeMap[P] & HttpMethod
  : never;

export type RouteTypeParts<
  P extends RoutePath,
  M extends HttpMethod,
> = P extends keyof RouteTypeMap
  ? M extends keyof RouteTypeMap[P]
    ? keyof RouteTypeMap[P][M] & RouteTypePart
    : never
  : never;

type ValidMethodOrParams<P extends RoutePath> = P extends keyof RouteTypeMap
  ? {
      [K in keyof RouteTypeMap[P]]: K extends HttpMethod ? K : never;
    }[keyof RouteTypeMap[P]] extends infer Methods
    ? {
        [Method in keyof RouteTypeMap[P]]: Method extends HttpMethod
          ? RouteTypeMap[P][Method] extends { Params: any }
            ? true
            : false
          : false;
      }[keyof RouteTypeMap[P]] extends true
      ? Methods | 'Params'
      : Methods
    : never
  : never;

type ValidTypePartForMethod<
  P extends RoutePath,
  M extends HttpMethod,
> = P extends keyof RouteTypeMap
  ? M extends keyof RouteTypeMap[P]
    ? {
        [K in keyof RouteTypeMap[P][M]]: K extends RouteTypePart
          ? K extends 'Params'
            ? never
            : K
          : never;
      }[keyof RouteTypeMap[P][M]]
    : never
  : never;

export type RouteType<
  P extends RoutePath,
  M extends ValidMethodOrParams<P> = never,
  T extends M extends 'Params'
    ? never
    : M extends HttpMethod
    ? ValidTypePartForMethod<P, M>
    : never = M extends 'Params'
    ? never
    : M extends HttpMethod
    ? ValidTypePartForMethod<P, M>
    : never,
> = P extends keyof RouteTypeMap
  ? M extends 'Params'
    ? P extends keyof RouteTypeMap
      ? {
          [Method in keyof RouteTypeMap[P]]: Method extends HttpMethod
            ? 'Params' extends keyof RouteTypeMap[P][Method]
              ? RouteTypeMap[P][Method]['Params']
              : never
            : never;
        }[keyof RouteTypeMap[P]]
      : never
    : M extends keyof RouteTypeMap[P]
    ? T extends keyof RouteTypeMap[P][M]
      ? RouteTypeMap[P][M][T]
      : never
    : never
  : never;
`;
  } else if (SEPARATE_TYPES) {
    // Use v1 type generation
    log.debug('Collecting type definitions...');
    typeDefinitions = collectTypesFromTree(tree, [], typeDefinitions, log);
  }

  // Generate API implementation
  log.debug('Generating API implementation...');
  let apiImpl = 'return {\n';
  apiImpl += generateFromTree(
    tree,
    '  ',
    [],
    SEPARATE_TYPES,
    USE_TYPES_V2,
    log,
  );
  apiImpl += '};';

  // Generate TypeScript interface
  log.debug('Generating TypeScript interface...');
  let apiInterface = 'interface ApiMethods {\n  [key: string]: any;\n';
  const interfaceSig = generateInterfaceFromTree(
    tree,
    '  ',
    [],
    SEPARATE_TYPES,
    USE_TYPES_V2,
    log,
  );
  if (interfaceSig) {
    apiInterface += '  ' + interfaceSig.split('; ').join(';\n  ') + ';\n';
  }
  apiInterface += '}\n';

  // Generate type definitions
  let typeDefsCode = '';
  if (USE_TYPES_V2) {
    // Generate v2 types: RouteTypeMap first, then helper types that reference it
    typeDefsCode = `${routeTypeMapCode}\n\n${routeTypeHelperCode}\n\n`;
  } else if (SEPARATE_TYPES && typeDefinitions.size > 0) {
    // Generate v1 types: individual type exports
    log.debug(
      `Generating ${typeDefinitions.size} separate type definitions...`,
    );
    typeDefinitions.forEach(({ name, type }) => {
      typeDefsCode += `export type ${name} = ${type};\n`;
    });
    typeDefsCode += '\n';
  }

  // Assemble final generated code
  const generatedCode = `/**
 * Auto-generated API client
 * Generated at: ${new Date().toISOString()}
 * Base URL: ${API_BASE}
 * 
 * DO NOT EDIT THIS FILE MANUALLY
 */

import { createRequest, createClient as createBaseClient, type ClientOptions } from '${packageJson.name}';

${typeDefsCode}${apiInterface}

const request = createRequest({ baseUrl: '${API_BASE}' });

const generateApiObject = (requestFn: ReturnType<typeof createRequest>): ApiMethods => {
  ${apiImpl}
};

export const createClient = (options: ClientOptions = {}) => {
  return createBaseClient(generateApiObject)({
    ...options,
    baseUrl: options.baseUrl || '${API_BASE}',
  });
};

export const api: ApiMethods = generateApiObject(request);
`;

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT);
  if (!fs.existsSync(outputDir)) {
    log.debug(`Creating output directory: ${outputDir}`);
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Display generation summary
  log.info('\n📊 Generation Summary:');
  log.info(`   Routes: ${totalGeneratedRoutes}`);
  log.info(`   Methods: ${totalGeneratedMethods}`);
  log.info(`   Output: ${OUTPUT}\n`);

  // Write output file
  if (options.format !== false) {
    try {
      log.debug('Formatting code with Prettier...');
      const formatted = await prettier.format(generatedCode, {
        parser: 'typescript',
        semi: true,
        singleQuote: true,
        trailingComma: 'es5',
        printWidth: 120,
        tabWidth: 2,
      });
      fs.writeFileSync(OUTPUT, formatted);
      log.success('API client generated and formatted successfully!');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.warning(`Formatting failed: ${errorMessage}`);
      log.debug('Writing unformatted code...');
      fs.writeFileSync(OUTPUT, generatedCode);
      log.success('API client generated (unformatted)');
    }
  } else {
    log.debug('Skipping formatting...');
    fs.writeFileSync(OUTPUT, generatedCode);
    log.success('API client generated successfully!');
  }
}
