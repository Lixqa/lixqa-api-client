/**
 * RouteType helper type for v2 type generation
 * Provides intellisense for route types using a generic helper
 */

/**
 * Route type parts that can be requested
 */
export type RouteTypePart =
  | 'RequestBody'
  | 'ResponseBody'
  | 'RequestQuery'
  | 'Params';

/**
 * HTTP methods
 */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

/**
 * Route type map - maps route paths to their type definitions
 * This interface is defined in the generated RouteTypeMap
 * We declare it here for type checking purposes (without index signature
 * so keyof works correctly for intellisense)
 */
declare interface RouteTypeMap {
  // This will be replaced by the actual RouteTypeMap interface in generated code
  // No index signature here - the actual interface has literal keys only
}

/**
 * Extract all route paths from RouteTypeMap for intellisense
 */
export type RoutePath = keyof RouteTypeMap & string;

/**
 * Extract all methods for a given route path
 * Only returns methods that actually exist for that path
 * Uses conditional type to filter out invalid methods
 */
export type RouteMethods<P extends RoutePath> = P extends keyof RouteTypeMap
  ? keyof RouteTypeMap[P] & HttpMethod
  : never;

/**
 * Extract all type parts for a given route path and method
 * Only returns type parts that actually exist for that method/path combination
 * Uses conditional types to filter out invalid combinations
 */
export type RouteTypeParts<
  P extends RoutePath,
  M extends HttpMethod,
> = P extends keyof RouteTypeMap
  ? M extends keyof RouteTypeMap[P]
    ? keyof RouteTypeMap[P][M] & RouteTypePart
    : never
  : never;

/**
 * Helper to extract valid method for a path as a union type
 * This helps TypeScript's intellisense filter options better
 */
type ValidMethodForPath<P extends RoutePath> = P extends keyof RouteTypeMap
  ? {
      [K in keyof RouteTypeMap[P]]: K extends HttpMethod ? K : never;
    }[keyof RouteTypeMap[P]]
  : never;

/**
 * Helper to extract valid type parts for a path/method combination
 * This helps TypeScript's intellisense filter options better
 */
type ValidTypePartForPathMethod<
  P extends RoutePath,
  M extends HttpMethod,
> = P extends keyof RouteTypeMap
  ? M extends keyof RouteTypeMap[P]
    ? {
        [K in keyof RouteTypeMap[P][M]]: K extends RouteTypePart ? K : never;
      }[keyof RouteTypeMap[P][M]]
    : never
  : never;

/**
 * RouteType generic helper
 * Provides intellisense for route types with proper safety
 *
 * Parameter order: Path first, then Method, then TypePart
 * This allows TypeScript to filter methods based on the selected path
 *
 * The constraints use explicit union extraction to help TypeScript's
 * intellisense filter out invalid options before they appear
 *
 * Method and TypePart are optional to allow path intellisense to show immediately
 *
 * @example
 * RouteType<"users/avatar", "GET", "ResponseBody">
 * RouteType<"users", "POST", "RequestBody">
 * RouteType<"users/avatar"> // Shows all valid methods and type parts
 */
export type RouteType<
  P extends RoutePath,
  M extends ValidMethodForPath<P>,
  T extends ValidTypePartForPathMethod<P, M>,
> = P extends keyof RouteTypeMap
  ? M extends keyof RouteTypeMap[P]
    ? T extends keyof RouteTypeMap[P][M]
      ? RouteTypeMap[P][M][T]
      : never
    : never
  : never;
