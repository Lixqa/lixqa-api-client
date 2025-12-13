import { RequestError, ValidationError } from './errors.js';

export interface ProxyRequest {
  url: string;
  method: string;
  body?: string | FormData;
  headers: Record<string, string>;
}

export interface ProxyResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: any;
  ok: boolean;
}

export type ProxyFn = (
  request: ProxyRequest,
) => Promise<ProxyResponse | Response>;

export interface ClientOptions {
  baseUrl?: string;
  authToken?: string;
  headers?: Record<string, string>;
  retryOnRatelimit?: number | false;
  proxyFn?: ProxyFn;
}

// Helper function to sleep/wait
const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// Helper function to normalize proxy response to Response-like object
const normalizeProxyResponse = (
  result: ProxyResponse | Response,
  url: string,
): Response => {
  // If it's already a Response, return it
  if (result instanceof Response) {
    return result;
  }

  // Otherwise, create a Response-like object
  const proxyResponse = result as ProxyResponse;
  const headers = new Headers(proxyResponse.headers);

  // Create a Response object from the proxy response
  // We'll use Response constructor if available, otherwise create a mock
  let body: string | undefined;
  if (typeof proxyResponse.body === 'string') {
    body = proxyResponse.body;
  } else {
    body = JSON.stringify(proxyResponse.body);
  }

  // Create a Response object
  return new Response(body, {
    status: proxyResponse.status,
    statusText: proxyResponse.statusText,
    headers: headers,
  });
};

export const createRequest = (options: ClientOptions = {}) => {
  const baseUrl = options.baseUrl || 'http://localhost:3000';
  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (options.authToken) {
    defaultHeaders['Authorization'] = options.authToken;
  }

  const retryOnRatelimit = options.retryOnRatelimit ?? false;
  const maxRetries =
    typeof retryOnRatelimit === 'number' ? retryOnRatelimit : 0;
  const proxyFn = options.proxyFn;

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

    // Helper function to make a single request attempt
    const makeRequest = async (): Promise<Response> => {
      const fetchOptions: RequestInit = {
        method,
        headers: { ...defaultHeaders },
      };

      let requestBody: string | FormData | undefined;

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

        requestBody = formData;
        fetchOptions.body = formData;
        // Remove Content-Type header for FormData (browser will set it with boundary)
        delete (fetchOptions.headers as any)['Content-Type'];
      } else if (requestOptions.body) {
        requestBody = JSON.stringify(requestOptions.body);
        fetchOptions.body = requestBody;
      }

      // Use proxyFn if provided
      if (proxyFn) {
        const proxyRequest: ProxyRequest = {
          url: url.toString(),
          method: method.toUpperCase(),
          body: requestBody,
          headers: { ...defaultHeaders },
        };

        const proxyResult = await proxyFn(proxyRequest);
        return normalizeProxyResponse(proxyResult, url.toString());
      }

      // Otherwise use regular fetch
      return await fetch(url.toString(), fetchOptions);
    };

    // Retry logic for rate limits
    // Attempt up to (maxRetries + 1) times: initial attempt + retries
    const maxAttempts = maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await makeRequest();

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

        // Handle rate limit (429) with retry logic
        if (response.status === 429 && retryOnRatelimit !== false) {
          // Check if we have retries remaining (attempt is 0-indexed, so we need attempt < maxRetries)
          if (attempt < maxRetries) {
            // Extract rate limit headers
            const resetAfter = response.headers.get('x-ratelimit-reset-after');
            const reset = response.headers.get('x-ratelimit-reset');

            // Calculate wait time
            let waitTime = 0;
            if (resetAfter) {
              // x-ratelimit-reset-after is in milliseconds
              waitTime = parseInt(resetAfter, 10);
            } else if (reset) {
              // x-ratelimit-reset is a timestamp in milliseconds
              const resetTimestamp = parseInt(reset, 10);
              const now = Date.now();
              waitTime = Math.max(0, resetTimestamp - now);
            } else {
              // Fallback: wait 1 second if no rate limit info is available
              waitTime = 1000;
            }

            // Ensure waitTime is valid and not too large (max 5 minutes)
            waitTime = Math.min(Math.max(waitTime, 0), 300000);

            await sleep(waitTime);
            continue; // Retry the request
          }
          // If we've exhausted retries, fall through to throw the error
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

        const errorInfo = {
          status: response.status,
          statusText: response.statusText,
          url: url.toString(),
          method: method.toUpperCase(),
          headers,
          body: responseBody,
        };

        // Throw the error (either we're not retrying, or we've exhausted retries)
        if (isValidationError) {
          throw new ValidationError(errorInfo, responseBody.data);
        } else {
          throw new RequestError(errorInfo);
        }
      } else {
        // Success! Handle the response
        // Handle 204 No Content responses - no body to parse
        if (response.status === 204) {
          return undefined as T;
        }

        const fullResponse = await response.json();
        return fullResponse.data as T;
      }
    }

    // This should never be reached (loop always exits via return or throw)
    // But TypeScript requires a return/throw here
    throw new Error('Unexpected error: request loop completed without result');
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
