// Lixqa API Client Generator Module
// This module provides tools for generating TypeScript API clients

export { ClientOptions, createRequest, createClient } from './lib/base-client';
export { RequestError, ValidationError } from './lib/errors';
export type { RequestErrorInfo, ValidationErrorData, ValidationErrorResponse } from './lib/errors';

// The main functionality is provided by the CLI tool
// Run: npx @lixqa-api/client generate --help
