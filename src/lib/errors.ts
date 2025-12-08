/**
 * Error classes for API client
 */

export interface RequestErrorInfo {
  status: number;
  statusText: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/**
 * RequestError is thrown whenever a request is not OK
 */
export class RequestError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly url: string;
  public readonly method: string;
  public readonly headers: Record<string, string>;
  public readonly body: any;

  constructor(info: RequestErrorInfo) {
    const message = `Request failed with status ${info.status}: ${info.statusText}`;
    super(message);
    this.name = 'RequestError';
    this.status = info.status;
    this.statusText = info.statusText;
    this.url = info.url;
    this.method = info.method;
    this.headers = info.headers;
    this.body = info.body;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RequestError);
    }
  }
}

/**
 * ValidationError is a specialized RequestError for BadRequest cases
 * where the server returns zod validation errors
 */
export interface ValidationErrorData {
  body?: Record<string, any>;
  query?: Record<string, any>;
  params?: Record<string, any>;
}

/**
 * Utility type to get all possible paths in a nested object
 */
export type Paths<T> = T extends object
  ? {
      [K in keyof T]: K extends string | number
        ? T[K] extends object
          ? T[K] extends any[]
            ? K | `${K}.${Paths<T[K][number]>}`
            : K | `${K}.${Paths<T[K]>}`
          : K
        : never;
    }[keyof T]
  : never;

/**
 * Utility type to get the value type at a specific path
 */
export type PathValue<
  T,
  P extends Paths<T>,
> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? Rest extends Paths<T[K]>
      ? PathValue<T[K], Rest>
      : never
    : never
  : P extends keyof T
    ? T[P]
    : never;

/**
 * Utility type to flatten a nested object structure to dot notation
 * Example: { body: { email: "error" } } becomes { "body.email": "error" }
 */
export type Flatten<T, Prefix extends string = ''> = {
  [K in keyof T]: K extends string | number
    ? T[K] extends object
      ? T[K] extends any[]
        ? { [P in `${Prefix}${K}`]: T[K] }
        : Flatten<T[K], `${Prefix}${K}.`>
      : { [P in `${Prefix}${K}`]: T[K] }
    : never;
}[keyof T];

/**
 * Flattened version of ValidationErrorData where nested paths are flattened to dot notation
 * Example: { body: { email: "error" } } becomes { "body.email": "error" }
 */
export type FlattenedValidationErrorData =
  Flatten<ValidationErrorData> extends infer F
    ? {
        [K in keyof F]: F[K];
      }
    : never;

export interface ValidationErrorResponse {
  error: boolean;
  code: string;
  message: string;
  duration?: number;
  route?: {
    path: string;
    methods: string[];
  };
  data?: ValidationErrorData;
}

export class ValidationError extends RequestError {
  public readonly validationData: ValidationErrorData | undefined;

  constructor(info: RequestErrorInfo, validationData?: ValidationErrorData) {
    super(info);
    this.name = 'ValidationError';
    this.validationData = validationData;
  }

  /**
   * Flattens the validation error data into a single object with dot-notation keys
   * Example: { body: { email: "error" } } becomes { "body.email": "error" }
   */
  flatten(): Record<string, any> {
    if (!this.validationData) {
      return {};
    }

    const result: Record<string, any> = {};

    const flattenObject = (obj: any, prefix = ''): void => {
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const value = obj[key];
          const newKey = prefix ? `${prefix}.${key}` : key;

          if (value && typeof value === 'object' && !Array.isArray(value)) {
            flattenObject(value, newKey);
          } else {
            result[newKey] = value;
          }
        }
      }
    };

    flattenObject(this.validationData);
    return result;
  }

  /**
   * Gets all error paths as an array of strings
   * Example: ["body.email", "query.page", "params.id"]
   */
  getPaths(): string[] {
    return Object.keys(this.flatten());
  }

  /**
   * Gets the error value at a specific path
   * @param path - Dot-notation path (e.g., "body.email" or "query.page")
   */
  getErrorAtPath(path: string): any {
    const flattened = this.flatten();
    return flattened[path];
  }

  /**
   * Checks if there's an error at a specific path
   * @param path - Dot-notation path (e.g., "body.email" or "query.page")
   */
  hasErrorAtPath(path: string): boolean {
    return this.getErrorAtPath(path) !== undefined;
  }

  /**
   * Extracts all error messages from the validation data
   * Recursively traverses the object and collects all strings from `_errors` arrays
   * Example: Returns ["Must be numbers only"] from { body: { discordId: { _errors: ["Must be numbers only"] } } }
   */
  getErrorMessages(): string[] {
    if (!this.validationData) {
      return [];
    }

    const errors: string[] = [];

    const collectErrors = (obj: any): void => {
      if (!obj || typeof obj !== 'object') {
        return;
      }

      // Check if this object has an `_errors` array
      if (Array.isArray(obj._errors)) {
        for (const error of obj._errors) {
          if (typeof error === 'string') {
            errors.push(error);
          }
        }
      }

      // Recursively traverse all properties
      for (const key in obj) {
        if (
          Object.prototype.hasOwnProperty.call(obj, key) &&
          key !== '_errors'
        ) {
          collectErrors(obj[key]);
        }
      }
    };

    collectErrors(this.validationData);
    return errors;
  }

  /**
   * Extracts all error messages with their paths as an array of objects
   * Example: Returns [{ path: "body.discordId", message: "Must be numbers only" }]
   */
  getErrorMessagesWithPaths(): Array<{ path: string; message: string }> {
    if (!this.validationData) {
      return [];
    }

    const errors: Array<{ path: string; message: string }> = [];

    const collectErrors = (obj: any, currentPath = ''): void => {
      if (!obj || typeof obj !== 'object') {
        return;
      }

      // Check if this object has an `_errors` array
      if (Array.isArray(obj._errors)) {
        for (const error of obj._errors) {
          if (typeof error === 'string') {
            errors.push({
              path: currentPath || 'root',
              message: error,
            });
          }
        }
      }

      // Recursively traverse all properties
      for (const key in obj) {
        if (
          Object.prototype.hasOwnProperty.call(obj, key) &&
          key !== '_errors'
        ) {
          const newPath = currentPath ? `${currentPath}.${key}` : key;
          collectErrors(obj[key], newPath);
        }
      }
    };

    collectErrors(this.validationData);
    return errors;
  }

  /**
   * Extracts error messages grouped by path
   * Example: Returns { "body.discordId": ["Must be numbers only"] }
   */
  getErrorMessagesByPath(): Record<string, string[]> {
    if (!this.validationData) {
      return {};
    }

    const errorsByPath: Record<string, string[]> = {};

    const collectErrors = (obj: any, currentPath = ''): void => {
      if (!obj || typeof obj !== 'object') {
        return;
      }

      // Check if this object has an `_errors` array
      if (Array.isArray(obj._errors) && obj._errors.length > 0) {
        const path = currentPath || 'root';
        const messages = obj._errors.filter(
          (error: any) => typeof error === 'string',
        ) as string[];
        if (messages.length > 0) {
          errorsByPath[path] = messages;
        }
      }

      // Recursively traverse all properties
      for (const key in obj) {
        if (
          Object.prototype.hasOwnProperty.call(obj, key) &&
          key !== '_errors'
        ) {
          const newPath = currentPath ? `${currentPath}.${key}` : key;
          collectErrors(obj[key], newPath);
        }
      }
    };

    collectErrors(this.validationData);
    return errorsByPath;
  }

  /**
   * Extracts error messages as formatted strings with paths
   * Example: Returns ["body.discordId: Must be numbers only"]
   */
  getErrorMessagesFormatted(separator = ': '): string[] {
    return this.getErrorMessagesWithPaths().map(
      ({ path, message }) => `${path}${separator}${message}`,
    );
  }
}
