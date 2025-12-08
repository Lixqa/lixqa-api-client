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
}

