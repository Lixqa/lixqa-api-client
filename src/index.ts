// Lixqa API Client Generator Module
// This module provides tools for generating TypeScript API clients

export {
  ClientOptions,
  createRequest,
  createClient,
} from './lib/base-client.js';
export type {
  ProxyRequest,
  ProxyResponse,
  ProxyFn,
} from './lib/base-client.js';
export { RequestError, ValidationError } from './lib/errors.js';
export type {
  RequestErrorInfo,
  ValidationErrorData,
  ValidationErrorResponse,
} from './lib/errors.js';

// The main functionality is provided by the CLI tool
// Run: npx @lixqa-api/client generate --help
