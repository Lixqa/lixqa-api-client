/**
 * Schema map generation for --with-schemas
 * Collects Zod schema code per route/method/part and emits RouteSchemaMap + getSchema.
 * Does not modify existing parsers or type-converter.
 */

import type { Route } from './name-generator.js';
import type { TreeNode } from './tree-builder.js';
import type { MethodSchema } from './type-converter.js';
import { zodDefToZodSchemaCode } from './schema-converter.js';
import type { Logger } from './logger.js';

type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export interface RouteSchemaMap {
  [routePath: string]: {
    [method in HttpMethod]?: {
      RequestBody?: string;
      ResponseBody?: string;
      RequestQuery?: string;
    };
  };
}

function normalizePath(path: string): string {
  let normalized = path.startsWith('/') ? path.slice(1) : path;
  normalized = normalized.replace(/:[^/]+/g, '$');
  return normalized;
}

function normalizeMethod(method: string): HttpMethod {
  return method.toUpperCase() as HttpMethod;
}

/**
 * Collects route schema code from the tree (same structure as RouteTypeMap)
 */
export function collectRouteSchemasV2(
  node: TreeNode,
  routeSchemaMap: RouteSchemaMap = {},
  log: Logger | null = null,
): RouteSchemaMap {
  node.methods.forEach((route: Route, method: string) => {
    const methodSchema = (route.schema?.[method] || {}) as
      | MethodSchema
      | undefined;
    const normalizedMethod = normalizeMethod(method);
    const normalizedPath = normalizePath(route.path);

    if (!routeSchemaMap[normalizedPath]) {
      routeSchemaMap[normalizedPath] = {};
    }
    if (!routeSchemaMap[normalizedPath][normalizedMethod]) {
      routeSchemaMap[normalizedPath][normalizedMethod] = {};
    }

    const entry = routeSchemaMap[normalizedPath][normalizedMethod]!;

    if (methodSchema?.response) {
      entry.ResponseBody = zodDefToZodSchemaCode(
        methodSchema.response as Parameters<typeof zodDefToZodSchemaCode>[0],
        log,
      );
    }
    if (methodSchema?.body !== undefined) {
      entry.RequestBody = zodDefToZodSchemaCode(
        methodSchema.body as Parameters<typeof zodDefToZodSchemaCode>[0],
        log,
      );
    }
    if (methodSchema?.query !== undefined) {
      entry.RequestQuery = zodDefToZodSchemaCode(
        methodSchema.query as Parameters<typeof zodDefToZodSchemaCode>[0],
        log,
      );
    }
  });

  node.static.forEach((childNode) => {
    collectRouteSchemasV2(childNode, routeSchemaMap, log);
  });

  node.params.forEach((childNode) => {
    collectRouteSchemasV2(childNode, routeSchemaMap, log);
  });

  return routeSchemaMap;
}

/**
 * Escapes a string for use inside a template or double-quoted key in generated code
 */
function escapeKey(key: string): string {
  return key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Generates the RouteSchemaMap const and getSchema function (source code string)
 */
export function generateRouteSchemaMapAndGetSchema(
  routeSchemaMap: RouteSchemaMap,
): string {
  const pathEntries: string[] = [];

  Object.entries(routeSchemaMap).forEach(([path, methods]) => {
    const methodEntries: string[] = [];

    Object.entries(methods).forEach(([method, parts]) => {
      if (!parts || typeof parts !== 'object') return;

      const partEntries: string[] = [];
      if (parts.RequestBody) {
        partEntries.push(`RequestBody: ${parts.RequestBody}`);
      }
      if (parts.ResponseBody) {
        partEntries.push(`ResponseBody: ${parts.ResponseBody}`);
      }
      if (parts.RequestQuery) {
        partEntries.push(`RequestQuery: ${parts.RequestQuery}`);
      }

      if (partEntries.length > 0) {
        methodEntries.push(`${method}: { ${partEntries.join(', ')} }`);
      }
    });

    if (methodEntries.length > 0) {
      pathEntries.push(`"${escapeKey(path)}": { ${methodEntries.join(', ')} }`);
    }
  });

  const mapCode =
    pathEntries.length > 0
      ? `const RouteSchemaMap = {\n  ${pathEntries.join(',\n  ')}\n} as const;\n\n`
      : 'const RouteSchemaMap = {} as const;\n\n';

  const getSchemaCode = `export type RouteSchemaMapType = typeof RouteSchemaMap;

export function getSchema<
  P extends keyof RouteSchemaMapType,
  M extends keyof RouteSchemaMapType[P],
  T extends keyof RouteSchemaMapType[P][M],
>(path: P, method: M, part: T): RouteSchemaMapType[P][M][T] {
  return (RouteSchemaMap as RouteSchemaMapType)[path]?.[method]?.[part] as RouteSchemaMapType[P][M][T];
}
`;

  return mapCode + getSchemaCode;
}
