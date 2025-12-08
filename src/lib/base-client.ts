import { RequestError, ValidationError } from './errors.js';

export interface ClientOptions {
  baseUrl?: string;
  authToken?: string;
  headers?: Record<string, string>;
}

export const createRequest = (options: ClientOptions = {}) => {
  const baseUrl = options.baseUrl || 'http://localhost:3000';
  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (options.authToken) {
    defaultHeaders['Authorization'] = options.authToken;
  }

  return async <T = any>(
    path: string,
    method: string,
    requestOptions: { body?: any; query?: any; files?: any } = {},
  ): Promise<T> => {
    // Parse base URL to preserve its path component
    const baseUrlObj = new URL(baseUrl);
    // If path starts with /, remove it so it's relative to base URL's path
    const relativePath = path.startsWith('/') ? path.slice(1) : path;
    // Combine base URL path with relative path
    const fullPath = baseUrlObj.pathname.endsWith('/')
      ? baseUrlObj.pathname + relativePath
      : baseUrlObj.pathname + '/' + relativePath;
    // Construct full URL preserving origin and path
    const url = new URL(fullPath, baseUrlObj.origin);
    // Preserve any existing search params and hash from base URL
    if (baseUrlObj.search) {
      baseUrlObj.searchParams.forEach((value, key) => {
        url.searchParams.append(key, value);
      });
    }
    if (baseUrlObj.hash) {
      url.hash = baseUrlObj.hash;
    }
    if (requestOptions.query)
      Object.entries(requestOptions.query).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.append(key, String(value));
      });

    const fetchOptions: RequestInit = {
      method,
      headers: { ...defaultHeaders },
    };

    // Handle file uploads with FormData
    if (requestOptions.files) {
      const formData = new FormData();

      // Handle single file
      if (requestOptions.files.file) {
        formData.append('file', requestOptions.files.file);
      }

      // Handle multiple files
      if (
        requestOptions.files.files &&
        Array.isArray(requestOptions.files.files)
      ) {
        requestOptions.files.files.forEach((file: File) => {
          formData.append('files', file);
        });
      }

      // Add other form fields if body is provided
      if (requestOptions.body) {
        Object.entries(requestOptions.body).forEach(([key, value]) => {
          if (value !== undefined) {
            formData.append(key, String(value));
          }
        });
      }

      fetchOptions.body = formData;
      // Remove Content-Type header for FormData (browser will set it with boundary)
      delete (fetchOptions.headers as any)['Content-Type'];
    } else if (requestOptions.body) {
      fetchOptions.body = JSON.stringify(requestOptions.body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (!response.ok) {
      // Collect response headers
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Try to parse response body
      let responseBody: any;
      const contentType = response.headers.get('content-type');
      const isJson = contentType?.includes('application/json');

      try {
        if (isJson) {
          responseBody = await response.json();
        } else {
          responseBody = await response.text();
        }
      } catch (e) {
        // If parsing fails, use empty object
        responseBody = {};
      }

      // Check if this is a validation error (BadRequest with zod header)
      // Use response.headers.get() which handles case-insensitivity
      const badRequestType = response.headers
        .get('x-bad-request-type')
        ?.toLowerCase();
      const isValidationError =
        response.status === 400 &&
        badRequestType === 'zod' &&
        responseBody?.data;

      console.debug(
        'isValidationError',
        isValidationError,
        response.status,
        badRequestType,
        Array.from(response.headers.values()),
        responseBody,
      );

      const errorInfo = {
        status: response.status,
        statusText: response.statusText,
        url: url.toString(),
        method: method.toUpperCase(),
        headers,
        body: responseBody,
      };

      if (isValidationError) {
        throw new ValidationError(errorInfo, responseBody.data);
      } else {
        throw new RequestError(errorInfo);
      }
    }

    // Handle 204 No Content responses - no body to parse
    if (response.status === 204) {
      return undefined as T;
    }

    const fullResponse = await response.json();

    return fullResponse.data as T;
  };
};

// This will be imported and used by the generated client
export const createClient = <T extends Record<string, any>>(
  generateApiObject: (requestFn: ReturnType<typeof createRequest>) => T,
) => {
  return (options: ClientOptions = {}) => {
    const requestFn = createRequest(options);
    return generateApiObject(requestFn);
  };
};
