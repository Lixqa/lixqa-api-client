/**
 * Type conversion utilities
 * Converts Zod schema definitions to TypeScript type strings
 */

import type { Logger } from './logger.js';

/**
 * Zod definition structure (simplified type for our use case)
 */
interface ZodDef {
  def?: {
    type: string;
    innerType?: ZodDef;
    element?: ZodDef;
    shape?: Record<string, ZodDef>;
    options?: ZodDef[];
    enum?: unknown[];
    entries?: Record<string, unknown>;
    values?: unknown[];
    value?: unknown;
    getter?: () => ZodDef;
    defaultValue?: unknown;
  };
  __fileOptions?: FileOptions;
}

/**
 * File upload options
 */
interface FileOptions {
  multiple?: boolean;
  required?: boolean;
  maxFiles?: number;
  allowedExtensions?: string[];
  maxSize?: number;
}

/**
 * Method schema structure
 */
export interface MethodSchema {
  body?: ZodDef;
  query?: ZodDef;
  response?: ZodDef;
  files?: ZodDef;
}

/**
 * Converts a Zod definition to a TypeScript type string
 * @param zodDef - Zod schema definition object
 * @param isOptional - Whether the type is optional (for internal recursion)
 * @param log - Logger instance for debug messages
 * @returns TypeScript type string
 */
export function zodDefToTypeScript(
  zodDef: ZodDef | undefined | null,
  isOptional = false,
  log: Logger | null = null,
): string {
  if (!zodDef || !zodDef.def) {
    log?.debug(
      `zodDefToTypeScript: Returning 'any' - zodDef is missing or has no def. zodDef: ${JSON.stringify(zodDef)}`,
    );
    return 'any';
  }

  const def = zodDef.def;

  switch (def.type) {
    case 'string':
      return 'string';

    case 'number':
      return 'number';

    case 'boolean':
      return 'boolean';

    case 'date':
      return 'Date';

    case 'enum':
      return convertEnumType(def, log);

    case 'any':
      return 'any';

    case 'never':
      return 'never';

    case 'null':
      return 'null';

    case 'literal':
      return convertLiteralType(def, log);

    case 'optional':
      return zodDefToTypeScript(def.innerType, true, log);

    case 'nonoptional':
      // Nonoptional type: makes an optional type required again
      // Just return the inner type (which might have been optional, but nonoptional removes that)
      if (def.innerType) {
        return zodDefToTypeScript(def.innerType, isOptional, log);
      } else {
        log?.debug(
          `zodDefToTypeScript: Returning 'any' - Nonoptional type has no innerType. Def: ${JSON.stringify(def)}`,
        );
        return 'any';
      }

    case 'default':
      // Default type: has a default value, so the field is optional in TypeScript
      // The inner type is what gets used, but the field itself is optional
      if (def.innerType) {
        return zodDefToTypeScript(def.innerType, true, log);
      } else {
        log?.debug(
          `zodDefToTypeScript: Returning 'any' - Default type has no innerType. Def: ${JSON.stringify(def)}`,
        );
        return 'any';
      }

    case 'nullable':
      // Nullable type: T | null
      const nullableInnerType = def.innerType
        ? zodDefToTypeScript(def.innerType, false, log)
        : 'any';
      return `${nullableInnerType} | null`;

    case 'lazy':
      // Lazy type: used for recursive types, has a getter function
      return convertLazyType(def, log);

    case 'array':
      return convertArrayType(def, log);

    case 'object':
      return convertObjectType(def, log);

    case 'union':
      return convertUnionType(def, log);

    case 'void':
      return 'void';

    default:
      log?.debug(
        `zodDefToTypeScript: Returning 'any' - Unhandled zod type: ${def.type}. Full def: ${JSON.stringify(def)}`,
      );
      return 'any';
  }
}

/**
 * Converts an enum Zod definition to TypeScript
 * @param def - Enum definition
 * @param log - Logger instance
 * @returns TypeScript type string
 */
function convertEnumType(def: ZodDef['def'], log: Logger | null): string {
  if (!def) return 'string';

  if (def.enum && Array.isArray(def.enum)) {
    const enumValues = def.enum.map((value) => `"${value}"`).join(' | ');
    return enumValues;
  }

  if (def.entries && typeof def.entries === 'object') {
    const enumValues = Object.keys(def.entries)
      .map((key) => `"${key}"`)
      .join(' | ');
    return enumValues;
  }

  return 'string';
}

/**
 * Converts a literal Zod definition to TypeScript
 * @param def - Literal definition
 * @param log - Logger instance
 * @returns TypeScript type string
 */
function convertLiteralType(def: ZodDef['def'], log: Logger | null): string {
  if (!def) return 'any';

  // Literal type: represents a specific value (e.g., z.literal("hello") or z.literal(42))
  // Can have either a single 'value' or a 'values' array
  if (def.values && Array.isArray(def.values)) {
    // Multiple literal values (union of literals) or single value in array
    const literalTypes = def.values.map((value) => {
      if (typeof value === 'string') {
        return `"${value}"`;
      } else if (typeof value === 'boolean' || typeof value === 'number') {
        return String(value);
      } else if (value === null) {
        return 'null';
      } else {
        return JSON.stringify(value);
      }
    });
    return literalTypes.join(' | ');
  } else if (def.value !== undefined) {
    // Single literal value
    if (typeof def.value === 'string') {
      return `"${def.value}"`;
    } else if (
      typeof def.value === 'boolean' ||
      typeof def.value === 'number'
    ) {
      return String(def.value);
    } else if (def.value === null) {
      return 'null';
    } else {
      return JSON.stringify(def.value);
    }
  } else {
    log?.debug(
      `zodDefToTypeScript: Returning 'any' - Literal type has no value or values array. Def: ${JSON.stringify(def)}`,
    );
    return 'any';
  }
}

/**
 * Converts a lazy Zod definition to TypeScript
 * @param def - Lazy definition
 * @param log - Logger instance
 * @returns TypeScript type string
 */
function convertLazyType(def: ZodDef['def'], log: Logger | null): string {
  if (!def) return 'any';

  if (def.getter && typeof def.getter === 'function') {
    try {
      const lazySchema = def.getter();
      return zodDefToTypeScript(lazySchema, false, log);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log?.debug(
        `zodDefToTypeScript: Error calling lazy getter - ${errorMessage}. Def: ${JSON.stringify(def)}`,
      );
      return 'any';
    }
  } else {
    log?.debug(
      `zodDefToTypeScript: Returning 'any' - Lazy type has no getter function. Def: ${JSON.stringify(def)}`,
    );
    return 'any';
  }
}

/**
 * Converts an array Zod definition to TypeScript
 * @param def - Array definition
 * @param log - Logger instance
 * @returns TypeScript type string
 */
function convertArrayType(def: ZodDef['def'], log: Logger | null): string {
  if (!def) return 'any[]';

  const elementType = def.element
    ? zodDefToTypeScript(def.element, false, log)
    : (() => {
        log?.debug(
          `zodDefToTypeScript: Returning 'any' for array element - Array type has no element definition. Def: ${JSON.stringify(def)}`,
        );
        return 'any';
      })();

  // If the element type contains a union (has ' | '), wrap it in parentheses
  // to ensure correct operator precedence: ({a} | {b})[] instead of {a} | {b}[]
  // This handles arrays of unions, while unions of arrays are handled by convertUnionType
  const needsParentheses = elementType.includes(' | ');
  const wrappedElementType = needsParentheses
    ? `(${elementType})`
    : elementType;

  return `${wrappedElementType}[]`;
}

/**
 * Converts an object Zod definition to TypeScript
 * @param def - Object definition
 * @param log - Logger instance
 * @returns TypeScript type string
 */
function convertObjectType(def: ZodDef['def'], log: Logger | null): string {
  if (!def) return 'Record<string, any>';

  if (!def.shape) {
    log?.debug(
      `zodDefToTypeScript: Returning 'Record<string, any>' - Object type has no shape. Def: ${JSON.stringify(def)}`,
    );
    return 'Record<string, any>';
  }

  const props = Object.entries(def.shape)
    .map(([key, value]) => {
      const type = zodDefToTypeScript(value, false, log);
      // Fields are optional if they have 'optional' or 'default' type
      const optional =
        value.def?.type === 'optional' || value.def?.type === 'default'
          ? '?'
          : '';
      return `${key}${optional}: ${type}`;
    })
    .join('; ');

  return `{ ${props} }`;
}

/**
 * Converts a union Zod definition to TypeScript
 * @param def - Union definition
 * @param log - Logger instance
 * @returns TypeScript type string
 */
function convertUnionType(def: ZodDef['def'], log: Logger | null): string {
  if (!def) return 'any';

  if (!def.options || !Array.isArray(def.options)) {
    log?.debug(
      `zodDefToTypeScript: Returning 'any' - Union type has no options or options is not an array. Def: ${JSON.stringify(def)}`,
    );
    return 'any';
  }

  const unionTypes = def.options.map((option) =>
    zodDefToTypeScript(option, false, log),
  );
  return unionTypes.join(' | ');
}

/**
 * Checks if a Zod definition has required fields
 * @param zodDef - Zod schema definition
 * @returns True if the definition has required fields
 */
export function hasRequiredFields(zodDef: ZodDef | undefined | null): boolean {
  if (!zodDef || !zodDef.def) return false;

  const def = zodDef.def;
  if (def.type === 'object' && def.shape) {
    return Object.values(def.shape).some(
      (field) =>
        field.def?.type !== 'optional' && field.def?.type !== 'default',
    );
  }

  return true;
}

/**
 * Checks if a method schema has file uploads
 * @param methodSchema - Method schema object
 * @returns True if the method accepts file uploads
 */
export function hasFileUploads(
  methodSchema: MethodSchema | undefined | null,
): boolean {
  if (!methodSchema || !methodSchema.files) return false;

  const filesDef = methodSchema.files;
  return !!(
    filesDef &&
    filesDef.def &&
    filesDef.def.type === 'any' &&
    filesDef.__fileOptions !== undefined
  );
}

/**
 * File upload information
 */
export interface FileUploadInfo {
  multiple: boolean;
  required: boolean;
  maxFiles: number;
  allowedExtensions: string[];
  maxSize: number;
}

/**
 * Extracts file upload information from a method schema
 * @param methodSchema - Method schema object
 * @returns File upload info object or null if no file uploads
 */
export function getFileUploadInfo(
  methodSchema: MethodSchema | undefined | null,
): FileUploadInfo | null {
  if (!hasFileUploads(methodSchema)) return null;

  const filesDef = methodSchema!.files!;
  const fileOptions = filesDef.__fileOptions || {};

  return {
    multiple: fileOptions.multiple || false,
    required: fileOptions.required || false,
    maxFiles: fileOptions.maxFiles || 1,
    allowedExtensions: fileOptions.allowedExtensions || [],
    maxSize: fileOptions.maxSize || 5242880,
  };
}
