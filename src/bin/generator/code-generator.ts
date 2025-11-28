/**
 * Code generation utilities
 * Generates TypeScript code from the route tree structure
 */

import {
  zodDefToTypeScript,
  hasRequiredFields,
  hasFileUploads,
  getFileUploadInfo,
  type MethodSchema,
} from './type-converter.js';
import {
  generateTypeName,
  generateParamsTypeName,
  type Route,
} from './name-generator.js';
import type { Logger } from './logger.js';
import type { TreeNode } from './tree-builder.js';

/**
 * Generates a request call string for a route method
 * @param route - Route definition object
 * @param method - HTTP method
 * @param pathTemplate - Path template with template literals
 * @param accumulatedParams - Accumulated parameter names
 * @param separateTypes - Whether to use separate type definitions
 * @param log - Logger instance
 * @returns Generated request call code
 */
export function generateRequestCall(
  route: Route,
  method: string,
  pathTemplate: string,
  accumulatedParams: string[] = [],
  separateTypes = false,
  log: Logger | null = null,
): string {
  const methodSchema = (route.schema?.[method] || {}) as MethodSchema | undefined;
  const responseType =
    separateTypes && methodSchema?.response
      ? generateTypeName(route, method, 'ResponseBody', accumulatedParams)
      : methodSchema?.response
        ? zodDefToTypeScript(methodSchema.response, false, log)
        : 'any';

  const hasFiles = hasFileUploads(methodSchema);

  if (hasFiles) {
    const fileInfo = getFileUploadInfo(methodSchema);
    if (fileInfo?.multiple) {
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

/**
 * Generates a method signature string for a route method
 * @param route - Route definition object
 * @param method - HTTP method
 * @param accumulatedParams - Accumulated parameter names
 * @param separateTypes - Whether to use separate type definitions
 * @param log - Logger instance
 * @returns Generated method signature
 */
export function generateMethodSignature(
  route: Route,
  method: string,
  accumulatedParams: string[] = [],
  separateTypes = false,
  log: Logger | null = null,
): string {
  const methodSchema = (route.schema?.[method] || {}) as MethodSchema | undefined;
  const hasBody = methodSchema?.body !== undefined;
  const hasQuery = methodSchema?.query !== undefined;
  const hasFiles = hasFileUploads(methodSchema);

  const responseType =
    separateTypes && methodSchema?.response
      ? generateTypeName(route, method, 'ResponseBody', accumulatedParams)
      : methodSchema?.response
        ? zodDefToTypeScript(methodSchema.response, false, log)
        : 'any';

  if (!hasBody && !hasQuery && !hasFiles)
    return `() => Promise<${responseType}>`;

  const parts: string[] = [];
  let hasRequiredOptions = false;

  if (hasBody) {
    const bodyType = separateTypes
      ? generateTypeName(route, method, 'RequestBody', accumulatedParams)
      : zodDefToTypeScript(methodSchema!.body, false, log);
    const bodyRequired =
      bodyType !== 'any' && hasRequiredFields(methodSchema!.body);
    const bodyOptional = bodyRequired ? '' : '?';
    parts.push(`body${bodyOptional}: ${bodyType}`);
    if (bodyRequired) hasRequiredOptions = true;
  }

  if (hasQuery) {
    const queryType = separateTypes
      ? generateTypeName(route, method, 'RequestQuery', accumulatedParams)
      : zodDefToTypeScript(methodSchema!.query, false, log);
    const queryRequired =
      queryType !== 'any' && hasRequiredFields(methodSchema!.query);
    const queryOptional = queryRequired ? '' : '?';
    parts.push(`query${queryOptional}: ${queryType}`);
    if (queryRequired) hasRequiredOptions = true;
  }

  if (hasFiles) {
    const fileInfo = getFileUploadInfo(methodSchema);
    if (fileInfo?.multiple) {
      const filesOptional = fileInfo.required ? '' : '?';
      parts.push(`files${filesOptional}: File[]`);
      if (fileInfo.required) hasRequiredOptions = true;
    } else {
      const fileOptional = fileInfo?.required ? '' : '?';
      parts.push(`file${fileOptional}: File`);
      if (fileInfo?.required) hasRequiredOptions = true;
    }
  }

  const optionsRequired = hasRequiredOptions ? '' : '?';
  return `(options${optionsRequired}: { ${parts.join('; ')} }) => Promise<${responseType}>`;
}

/**
 * Type definition structure
 */
export interface TypeDefinition {
  name: string;
  type: string;
}

/**
 * Generates API implementation code from the tree structure
 * @param node - Tree node
 * @param indent - Current indentation string
 * @param accumulatedParams - Accumulated parameter names
 * @param separateTypes - Whether to use separate type definitions
 * @param log - Logger instance
 * @returns Generated implementation code
 */
export function generateFromTree(
  node: TreeNode,
  indent: string,
  accumulatedParams: string[] = [],
  separateTypes = false,
  log: Logger | null = null,
): string {
  let output = '';

  // Generate methods at this level
  node.methods.forEach((route, method) => {
    const methodLower = method.toLowerCase();
    const pathTemplate = route.path.replace(
      /:(\w+)/g,
      (_match, paramName) => `\${${paramName}}`,
    );
    output += `${indent}${methodLower}: (requestOptions: any = {}) => ${generateRequestCall(route, method, pathTemplate, accumulatedParams, separateTypes, log)},\n`;
  });

  // Generate static children
  node.static.forEach((childNode, name) => {
    output += `${indent}'${name}': {\n`;
    output += generateFromTree(
      childNode,
      indent + '  ',
      accumulatedParams,
      separateTypes,
      log,
    );
    output += `${indent}},\n`;
  });

  // Generate parameterized children
  node.params.forEach((childNode, paramName) => {
    const allParams = [...accumulatedParams, paramName];
    output += `${indent}$: (${paramName}: string | number) => ({\n`;
    output += generateFromTree(
      childNode,
      indent + '  ',
      allParams,
      separateTypes,
      log,
    );
    output += `${indent}}),\n`;
  });

  return output;
}

/**
 * Generates TypeScript interface code from the tree structure
 * @param node - Tree node
 * @param indent - Current indentation string
 * @param accumulatedParams - Accumulated parameter names
 * @param separateTypes - Whether to use separate type definitions
 * @param log - Logger instance
 * @returns Generated interface code
 */
export function generateInterfaceFromTree(
  node: TreeNode,
  indent: string,
  accumulatedParams: string[] = [],
  separateTypes = false,
  log: Logger | null = null,
): string {
  const signatures: string[] = [];

  // Generate method signatures at this level
  node.methods.forEach((route, method) => {
    const methodLower = method.toLowerCase();
    const signature = generateMethodSignature(
      route,
      method,
      accumulatedParams,
      separateTypes,
      log,
    );
    signatures.push(`${methodLower}: ${signature}`);
  });

  // Generate static children
  node.static.forEach((childNode, name) => {
    const childSigs = generateInterfaceFromTree(
      childNode,
      indent + '  ',
      accumulatedParams,
      separateTypes,
      log,
    );
    if (childSigs) {
      signatures.push(`'${name}': { ${childSigs} }`);
    }
  });

  // Generate parameterized children
  node.params.forEach((childNode, paramName) => {
    const allParams = [...accumulatedParams, paramName];
    const childSigs = generateInterfaceFromTree(
      childNode,
      indent + '  ',
      allParams,
      separateTypes,
      log,
    );
    if (childSigs) {
      signatures.push(
        `$: (${paramName}: string | number) => { ${childSigs} }`,
      );
    }
  });

  return signatures.join('; ');
}

/**
 * Collects all type definitions from the tree when separate-types is enabled
 * @param node - Tree node
 * @param accumulatedParams - Accumulated parameter names
 * @param typeDefinitions - Map to store collected type definitions
 * @param log - Logger instance
 * @returns Map of collected type definitions
 */
export function collectTypesFromTree(
  node: TreeNode,
  accumulatedParams: string[] = [],
  typeDefinitions: Map<string, TypeDefinition> = new Map(),
  log: Logger | null = null,
): Map<string, TypeDefinition> {
  // Collect method types at this level
  node.methods.forEach((route, method) => {
    const methodSchema = (route.schema?.[method] || {}) as MethodSchema | undefined;

    // Collect response type
    if (methodSchema?.response) {
      const typeName = generateTypeName(
        route,
        method,
        'ResponseBody',
        accumulatedParams,
      );
      if (!typeDefinitions.has(typeName)) {
        typeDefinitions.set(typeName, {
          name: typeName,
          type: zodDefToTypeScript(methodSchema.response, false, log),
        });
      }
    }

    // Collect body type
    if (methodSchema?.body !== undefined) {
      const typeName = generateTypeName(
        route,
        method,
        'RequestBody',
        accumulatedParams,
      );
      if (!typeDefinitions.has(typeName)) {
        typeDefinitions.set(typeName, {
          name: typeName,
          type: zodDefToTypeScript(methodSchema.body, false, log),
        });
      }
    }

    // Collect query type
    if (methodSchema?.query !== undefined) {
      const typeName = generateTypeName(
        route,
        method,
        'RequestQuery',
        accumulatedParams,
      );
      if (!typeDefinitions.has(typeName)) {
        typeDefinitions.set(typeName, {
          name: typeName,
          type: zodDefToTypeScript(methodSchema.query, false, log),
        });
      }
    }

    // Collect params type if route has params
    if (accumulatedParams.length > 0) {
      const typeName = generateParamsTypeName(route, method);
      if (!typeDefinitions.has(typeName)) {
        // Generate array type for params
        typeDefinitions.set(typeName, {
          name: typeName,
          type: `(string | number)[]`,
        });
      }
    }
  });

  // Recurse into static children
  node.static.forEach((childNode) => {
    collectTypesFromTree(childNode, accumulatedParams, typeDefinitions, log);
  });

  // Recurse into parameterized children
  node.params.forEach((childNode, paramName) => {
    const allParams = [...accumulatedParams, paramName];
    collectTypesFromTree(childNode, allParams, typeDefinitions, log);
  });

  return typeDefinitions;
}

