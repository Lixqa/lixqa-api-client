#!/usr/bin/env node

/**
 * Lixqa API Client Generator CLI
 *
 * This is the main entry point for the API client generator.
 * It sets up the command-line interface and delegates to the generator module.
 */

import { Command } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };
import { generateClient } from './generator/index.js';

const program = new Command();

// Configure CLI program
program
  .name('lixqa-api')
  .description('Generate TypeScript API client from Lixqa API schema')
  .version(packageJson.version);

// Define generate command
program
  .command('generate')
  .description('Generate TypeScript API client from API schema')
  .option('-u, --url <url>', 'API base URL', 'http://localhost:3000')
  .option(
    '-o, --output <path>',
    'Output file path',
    './generated/api-client.ts',
  )
  .option('--no-format', 'Skip code formatting')
  .option('-d, --debug', 'Enable debug logging')
  .option(
    '--separate-types',
    'Generate separate types for query, body, response, and params',
  )
  .option(
    '--use-types-v2',
    'Use RouteType generic for type definitions (requires --separate-types)',
  )
  .action(async (options) => {
    await generateClient(options);
  });

// Parse command-line arguments
program.parse();
