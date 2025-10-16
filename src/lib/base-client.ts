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
    defaultHeaders['Authorization'] = `Bearer ${options.authToken}`;
  }

  return async <T = any>(
    path: string,
    method: string,
    requestOptions: { body?: any; query?: any } = {},
  ): Promise<T> => {
    const url = new URL(baseUrl + path);
    if (requestOptions.query)
      Object.entries(requestOptions.query).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.append(key, String(value));
      });
    const fetchOptions: RequestInit = {
      method,
      headers: { ...defaultHeaders },
    };
    if (requestOptions.body)
      fetchOptions.body = JSON.stringify(requestOptions.body);
    const response = await fetch(url.toString(), fetchOptions);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

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
