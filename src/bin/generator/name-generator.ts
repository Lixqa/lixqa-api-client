/**
 * Name generation utilities
 * Generates TypeScript type names and identifiers from route paths and methods
 */

/**
 * Route definition interface
 */
export interface Route {
  path: string;
  methods?: string[];
  schema?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

/**
 * Converts a string segment to PascalCase
 * Handles dashes by splitting, capitalizing each word, and joining
 * @param segment - String segment to convert
 * @returns PascalCase string
 */
export function toPascalCase(segment: string): string {
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * Generates a type name for a route, method, and type suffix
 * Handles parameterized routes by inserting $ separators appropriately
 * @param route - Route definition object
 * @param method - HTTP method (GET, POST, etc.)
 * @param typeSuffix - Type suffix (e.g., 'ResponseBody', 'RequestBody')
 * @param accumulatedParams - Array of accumulated parameter names
 * @returns Generated type name
 */
export function generateTypeName(
  route: Route,
  method: string,
  typeSuffix: string,
  accumulatedParams: string[] = [],
): string {
  // Convert method to capitalized (GET -> Get, POST -> Post, etc.)
  const methodName = method.charAt(0) + method.slice(1).toLowerCase();

  // Split path into segments
  const segments = route.path.split('/').filter(Boolean);

  // Build path parts, using $ where there's a param between segments
  // Also add $ before type suffix if the last static segment has a param after it
  // Example: /organisations/:orgId/departments/:depId → GetOrganisations$Departments$ResponseBody
  // Example: /organisations/:orgId/departments → GetOrganisations$DepartmentsResponseBody
  const pathParts: string[] = [];
  let lastStaticSegmentIndex = -1;

  // First pass: collect static segments and find the last one
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].startsWith(':')) {
      lastStaticSegmentIndex = i;
    }
  }

  // Second pass: build path parts
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment.startsWith(':')) {
      // Static segment - check if there's a param before it
      const hasParamBefore = i > 0 && segments[i - 1].startsWith(':');

      // Add $ if there's a param before this static segment
      if (pathParts.length > 0 && hasParamBefore) {
        pathParts.push('$');
      }
      pathParts.push(toPascalCase(segment));
    }
  }

  // Add $ before type suffix if the last static segment has a param after it
  const hasParamAfterLastSegment =
    lastStaticSegmentIndex >= 0 &&
    lastStaticSegmentIndex < segments.length - 1 &&
    segments[lastStaticSegmentIndex + 1].startsWith(':');
  const suffixPrefix = hasParamAfterLastSegment ? '$' : '';

  // Join path parts (which may include $ separators) and add type suffix
  return `${methodName}${pathParts.join('')}${suffixPrefix}${typeSuffix}`;
}

/**
 * Generates a params type name for a route and method
 * @param route - Route definition object
 * @param method - HTTP method (GET, POST, etc.)
 * @returns Generated params type name
 */
export function generateParamsTypeName(route: Route, method: string): string {
  // Convert method to capitalized
  const methodName = method.charAt(0) + method.slice(1).toLowerCase();

  // Split path into segments
  const segments = route.path.split('/').filter(Boolean);

  // Process only static segments: convert to PascalCase and join with $
  const pathParts = segments
    .filter((segment) => !segment.startsWith(':')) // Skip param segments
    .map((segment) => toPascalCase(segment));

  // Join with $ and add $Params suffix
  return `${methodName}${pathParts.join('$')}$Params`;
}

