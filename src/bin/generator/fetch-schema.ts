/**
 * Schema fetching utilities
 * Handles fetching and parsing the API schema from the server
 */

import type { Logger } from './logger.js';

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
 * Fetches the API schema from the specified base URL
 * @param apiBase - Base URL of the API
 * @param log - Logger instance
 * @returns Promise resolving to an array of route definitions
 * @throws Error if the schema cannot be fetched or parsed
 */
export async function fetchApiSchema(
  apiBase: string,
  log: Logger,
): Promise<Route[]> {
  log.info(`Fetching API schema from ${apiBase}...`);

  try {
    const res = await fetch(`${apiBase}/__client__`);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const data = (await res.json()) as { data?: Route[] } | Route[];
    const routes = Array.isArray(data) ? data : data.data || [];

    log.info(`Found ${routes.length} routes`);
    return routes;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to fetch API schema: ${errorMessage}`);
    throw error;
  }
}
