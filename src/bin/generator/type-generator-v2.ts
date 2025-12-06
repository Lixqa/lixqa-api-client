/**
 * Type generator v2
 * Generates types using RouteType<Method, Path, TypePart> format
 */

import type { Route } from './name-generator.js';
import type { TreeNode } from './tree-builder.js';
import type { MethodSchema } from './type-converter.js';
import { zodDefToTypeScript } from './type-converter.js';
import type { Logger } from './logger.js';

/**
 * HTTP method
 */
type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

/**
 * Route type map structure
 */
export interface RouteTypeMap {
  [routePath: string]: {
    [method in HttpMethod]?: {
      RequestBody?: string;
      ResponseBody?: string;
      RequestQuery?: string;
      Params?: string;
    };
  };
}

/**
 * Normalizes a route path for use in RouteType
 * Converts /users/:id/avatar to users/$/avatar
 * Replaces :paramName with $ for parameterized segments
 * @param path - Route path
 * @returns Normalized path with $ for params
 */
function normalizePath(path: string): string {
  let normalized = path.startsWith('/') ? path.slice(1) : path;
  // Replace :paramName with $ for RouteType paths
  normalized = normalized.replace(/:[^/]+/g, '$');
  return normalized;
}

/**
 * Converts HTTP method to proper case
 * @param method - HTTP method
 * @returns Properly cased method
 */
function normalizeMethod(method: string): HttpMethod {
  const upper = method.toUpperCase();
  return upper as HttpMethod;
}

/**
 * Collects route types from the tree for v2 format
 * @param node - Tree node
 * @param accumulatedParams - Accumulated parameter names
 * @param routeTypeMap - Map to store route types
 * @param currentPath - Current path being built
 * @param log - Logger instance
 */
export function collectRouteTypesV2(
  node: TreeNode,
  accumulatedParams: string[] = [],
  routeTypeMap: RouteTypeMap = {},
  currentPath: string = '',
  log: Logger | null = null,
): RouteTypeMap {
  // Collect method types at this level
  node.methods.forEach((route, method) => {
    const methodSchema = (route.schema?.[method] || {}) as
      | MethodSchema
      | undefined;
    const normalizedMethod = normalizeMethod(method);
    const normalizedPath = normalizePath(route.path);

    // Initialize route entry if it doesn't exist
    if (!routeTypeMap[normalizedPath]) {
      routeTypeMap[normalizedPath] = {};
    }
    if (!routeTypeMap[normalizedPath][normalizedMethod]) {
      routeTypeMap[normalizedPath][normalizedMethod] = {};
    }

    const routeEntry = routeTypeMap[normalizedPath][normalizedMethod]!;

    // Collect response type
    if (methodSchema?.response) {
      routeEntry.ResponseBody = zodDefToTypeScript(
        methodSchema.response,
        false,
        log,
      );
    }

    // Collect body type
    if (methodSchema?.body !== undefined) {
      routeEntry.RequestBody = zodDefToTypeScript(
        methodSchema.body,
        false,
        log,
      );
    }

    // Collect query type
    if (methodSchema?.query !== undefined) {
      routeEntry.RequestQuery = zodDefToTypeScript(
        methodSchema.query,
        false,
        log,
      );
    }

    // Collect params type if route has params
    if (accumulatedParams.length > 0) {
      routeEntry.Params = `(string | number)[]`;
    }
  });

  // Recurse into static children
  node.static.forEach((childNode, name) => {
    collectRouteTypesV2(
      childNode,
      accumulatedParams,
      routeTypeMap,
      currentPath ? `${currentPath}/${name}` : name,
      log,
    );
  });

  // Recurse into parameterized children
  node.params.forEach((childNode, paramName) => {
    const allParams = [...accumulatedParams, paramName];
    // Use $ instead of :paramName for RouteType paths
    collectRouteTypesV2(
      childNode,
      allParams,
      routeTypeMap,
      currentPath ? `${currentPath}/$` : '$',
      log,
    );
  });

  return routeTypeMap;
}

/**
 * Generates the RouteTypeMap type definition code
 * @param routeTypeMap - Route type map
 * @returns Generated type definition code
 */
export function generateRouteTypeMapCode(routeTypeMap: RouteTypeMap): string {
  const entries: string[] = [];

  Object.entries(routeTypeMap).forEach(([path, methods]) => {
    const methodEntries: string[] = [];

    Object.entries(methods).forEach(([method, types]) => {
      const typeEntries: string[] = [];

      if (types.RequestBody) {
        typeEntries.push(`RequestBody: ${types.RequestBody}`);
      }
      if (types.ResponseBody) {
        typeEntries.push(`ResponseBody: ${types.ResponseBody}`);
      }
      if (types.RequestQuery) {
        typeEntries.push(`RequestQuery: ${types.RequestQuery}`);
      }
      if (types.Params) {
        typeEntries.push(`Params: ${types.Params}`);
      }

      if (typeEntries.length > 0) {
        methodEntries.push(`${method}: { ${typeEntries.join('; ')} }`);
      }
    });

    if (methodEntries.length > 0) {
      entries.push(`"${path}": { ${methodEntries.join('; ')} }`);
    }
  });

  return `export interface RouteTypeMap {\n  ${entries.join(';\n  ')};\n}`;
}

/**
 * Generates a RouteType reference for a route
 * @param route - Route definition
 * @param method - HTTP method
 * @param typePart - Type part (RequestBody, ResponseBody, etc.)
 * @param accumulatedParams - Accumulated parameter names
 * @returns RouteType reference string
 */
export function generateRouteTypeReference(
  route: Route,
  method: string,
  typePart: 'RequestBody' | 'ResponseBody' | 'RequestQuery' | 'Params',
): string {
  const normalizedPath = normalizePath(route.path);
  const normalizedMethod = normalizeMethod(method);
  // Changed order: Path first, then Method, then TypePart for better intellisense
  return `RouteType<"${normalizedPath}", "${normalizedMethod}", "${typePart}">`;
}
