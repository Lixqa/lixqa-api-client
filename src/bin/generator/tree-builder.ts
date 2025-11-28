/**
 * Tree building utilities
 * Builds a hierarchical tree structure from route definitions for efficient code generation
 */

import type { Logger } from './logger.js';
import type { Route as FetchRoute } from './fetch-schema.js';

/**
 * Route definition interface (after processing, methods is guaranteed)
 */
export interface Route extends Omit<FetchRoute, 'methods'> {
  methods: string[];
}

/**
 * Tree node structure for organizing routes
 */
export interface TreeNode {
  static: Map<string, TreeNode>;
  params: Map<string, TreeNode>;
  methods: Map<string, Route>;
}

/**
 * Builds a complete tree structure from route definitions
 * The tree separates static segments, parameter segments, and methods
 * @param routes - Array of route definition objects
 * @returns Tree structure with static, params, and methods maps
 */
export function buildCompleteTree(routes: Route[]): TreeNode {
  const tree: TreeNode = {
    static: new Map(),
    params: new Map(),
    methods: new Map(),
  };

  /**
   * Recursively inserts a route into the tree structure
   * @param node - Current tree node
   * @param segments - Path segments array
   * @param segmentIndex - Current segment index
   * @param route - Route definition object
   */
  function insertRoute(
    node: TreeNode,
    segments: string[],
    segmentIndex: number,
    route: Route,
  ): void {
    if (segmentIndex >= segments.length) {
      // At leaf - add methods
      route.methods.forEach((method) => {
        const settings = route.settings as
          | Record<string, { disabled?: boolean }>
          | undefined;
        if (!settings?.[method]?.disabled) {
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
      insertRoute(
        node.params.get(paramName)!,
        segments,
        segmentIndex + 1,
        route,
      );
    } else {
      // Static segment
      if (!node.static.has(segment)) {
        node.static.set(segment, {
          static: new Map(),
          params: new Map(),
          methods: new Map(),
        });
      }
      insertRoute(node.static.get(segment)!, segments, segmentIndex + 1, route);
    }
  }

  routes.forEach((route) => {
    const segments = route.path.split('/').filter(Boolean);
    insertRoute(tree, segments, 0, route);
  });

  return tree;
}

/**
 * Processes routes to extract available methods and prepare them for tree building
 * @param routes - Array of route definition objects (methods may be optional)
 * @param log - Logger instance
 * @returns Object with processed routes (methods guaranteed), total routes count, and total methods count
 */
export function processRoutes(
  routes: FetchRoute[],
  log: Logger,
): {
  routes: Route[];
  totalGeneratedRoutes: number;
  totalGeneratedMethods: number;
} {
  let totalGeneratedRoutes = 0;
  let totalGeneratedMethods = 0;

  const processedRoutes: Route[] = [];

  routes.forEach((route) => {
    const { settings, schema } = route;
    if ((settings as { disabled?: boolean })?.disabled) return;

    const availableMethods =
      route.methods && route.methods.length > 0
        ? route.methods
        : Object.keys(schema || {}).filter(
            (method) =>
              method !== 'params' &&
              typeof (schema as Record<string, unknown>)?.[method] ===
                'object' &&
              (schema as Record<string, unknown>)?.[method] !== null,
          );

    if (availableMethods.length === 0) {
      const hasParams =
        schema &&
        typeof (schema as Record<string, unknown>).params === 'object';
      if (!hasParams) {
        return;
      } else {
        availableMethods.push('GET');
      }
    }

    const processedRoute: Route = {
      ...route,
      methods: availableMethods,
    };
    processedRoutes.push(processedRoute);

    log.debug(
      `Route: ${processedRoute.path} → [${availableMethods.map((m) => m.toUpperCase()).join(', ')}]`,
    );
    totalGeneratedRoutes++;
    totalGeneratedMethods += availableMethods.length;
  });

  return {
    routes: processedRoutes,
    totalGeneratedRoutes,
    totalGeneratedMethods,
  };
}
