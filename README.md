# Lixqa API Client Generator

A TypeScript API client generator for Lixqa APIs. This tool automatically generates a fully-typed TypeScript client from your API schema.

## Installation

```bash
npm install -g @lixqa-api/client
```

## Quick Start

```bash
# Install the generator globally
npm install -g @lixqa-api/client

# Generate a client for your API
npx @lixqa-api/client generate --url https://your-api.com --output ./generated/api-client.ts

# Install the base client as a dependency in your project
npm install @lixqa-api/client

# Use the generated client in your project
import { api, createClient } from './generated/api-client';

// Start using your API
const users = await api.users.get();
```

## Usage

### Basic Usage

```bash
npx @lixqa-api/client generate --url https://my-api.com --output ./generated/api-client.ts
```

### Options

- `-u, --url <url>` - API base URL (default: http://localhost:3000)
- `-o, --output <path>` - Output file path (default: ./generated/api-client.ts)
- `--no-format` - Skip code formatting
- `-V, --version` - Show version number
- `-h, --help` - Show help

### Examples

```bash
# Generate client from local development server
npx @lixqa-api/client generate

# Generate client from production API
npx @lixqa-api/client generate --url https://api.myapp.com --output ./src/api/client.ts

# Generate without formatting
npx @lixqa-api/client generate --url https://api.myapp.com --no-format

# Generate with custom output directory
npx @lixqa-api/client generate \
  --url https://api.myapp.com \
  --output ./src/api/client.ts \
  --no-format
```

## Generated Client

The generated client provides:

- **Fully typed methods** for all API endpoints
- **Automatic parameter handling** for path parameters
- **Type-safe request/response** objects
- **Nested route structure** that matches your API organization
- **Promise-based** async/await support

### Example Generated Usage

#### Basic Usage (Default Client)

```typescript
import { api } from './generated/api-client';

// Simple GET request
const users = await api.users.get();

// POST request with body
const newUser = await api.users.post({
  body: { username: 'john', email: 'john@example.com' },
});

// Parameterized routes
const user = await api.users.$(123).get();
await api.users.$(123).delete();

// Query parameters
const filteredUsers = await api.users.get({
  query: { limit: 10, offset: 0 },
});
```

#### Custom Client with Configuration

```typescript
import { createClient } from './generated/api-client';

// Basic usage with default settings
const basicClient = createClient();
await basicClient.users.get();

// Custom base URL
const prodClient = createClient({
  baseUrl: 'https://api.myapp.com',
});

// With authentication token
const authClient = createClient({
  baseUrl: 'https://api.myapp.com',
  authToken: 'your-jwt-token-here',
});

// With custom headers
const customClient = createClient({
  baseUrl: 'https://api.myapp.com',
  headers: {
    'X-API-Key': 'your-api-key',
    'User-Agent': 'MyApp/1.0',
  },
});

// All clients work the same way
await authClient.users.me.get();
await customClient.users.post({
  body: { username: 'john', email: 'john@example.com' },
});
```

## Real-world Examples

### Complete Setup Example

```bash
# 1. Install the generator globally
npm install -g @lixqa-api/client

# 2. Generate a client for your API
npx @lixqa-api/client generate \
  --url https://api.myapp.com \
  --output ./src/api/client.ts

# 3. Install the base client dependency
npm install @lixqa-api/client
```

### Using in Your Application

```typescript
// src/api/client.ts (generated)
import {
  createRequest,
  createClient as createBaseClient,
} from '@lixqa-api/client';

// ... generated API methods ...

// src/app.ts (your application)
import { api, createClient } from './api/client';

async function main() {
  // Use the default client
  const users = await api.users.get();
  console.log('All users:', users);

  // Create authenticated client
  const authClient = createClient({
    baseUrl: 'https://api.myapp.com',
    authToken: process.env.API_TOKEN,
  });

  // Use authenticated client
  const user = await authClient.users.$(123).get();
  console.log('User 123:', user);

  // Create user with validation
  const newUser = await authClient.users.post({
    body: {
      username: 'john_doe',
      email: 'john@example.com',
      age: 25,
    },
  });
  console.log('Created user:', newUser);
}

main().catch(console.error);
```

### Environment-specific Configuration

```typescript
// config/api.ts
import { createClient } from './api/client';

const isDevelopment = process.env.NODE_ENV === 'development';

export const apiClient = createClient({
  baseUrl: isDevelopment ? 'http://localhost:3000' : 'https://api.myapp.com',
  authToken: process.env.API_TOKEN,
  headers: {
    'User-Agent': 'MyApp/1.0',
    'X-Client-Version': process.env.APP_VERSION,
  },
});

// Use throughout your app
export const { users, posts, comments } = apiClient;
```

## Module Structure

This module contains:

- **CLI Generator** (`src/bin/api.mjs`) - The main tool for generating clients
- **Base Client** (`src/lib/base-client.ts`) - Reusable utilities for generated clients
- **Example** (`generated/`) - Example generated client and usage

The generated client is completely separate from this module and can be used independently in your projects.

## Requirements

Your API must expose a `/__client__` endpoint that returns the route schema in the expected format.

## License

ISC
