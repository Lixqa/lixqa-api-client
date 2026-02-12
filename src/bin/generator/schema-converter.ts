/**
 * Schema conversion utilities
 * Converts Zod definition structures to Zod schema source code (string)
 * Used when --with-schemas is enabled to emit runtime Zod schemas.
 * Does not modify existing parsers or type-converter.
 */

import type { Logger } from './logger.js';

/**
 * Zod definition structure (mirrors type-converter for schema emission)
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
    value?: unknown;
    values?: unknown[];
    getter?: () => ZodDef;
    in?: ZodDef;
    out?: ZodDef;
  };
}

/**
 * Converts a Zod definition to Zod schema source code string
 * @param zodDef - Zod schema definition object (from API)
 * @param log - Logger instance for debug messages
 * @returns TypeScript code string that evaluates to a Zod schema (e.g. "z.string()")
 */
export function zodDefToZodSchemaCode(
  zodDef: ZodDef | undefined | null,
  log: Logger | null = null,
): string {
  if (!zodDef || !zodDef.def) {
    log?.debug(
      `zodDefToZodSchemaCode: Returning z.any() - zodDef missing or no def.`,
    );
    return 'z.any()';
  }

  const def = zodDef.def;

  switch (def.type) {
    case 'string':
      return 'z.string()';

    case 'number':
      return 'z.number()';

    case 'boolean':
      return 'z.boolean()';

    case 'date':
      return 'z.date()';

    case 'enum': {
      if (def.enum && Array.isArray(def.enum)) {
        const values = def.enum
          .map((v) => (typeof v === 'string' ? JSON.stringify(v) : String(v)))
          .join(', ');
        return `z.enum([${values}])`;
      }
      if (def.entries && typeof def.entries === 'object') {
        const values = Object.keys(def.entries)
          .map((k) => JSON.stringify(k))
          .join(', ');
        return `z.enum([${values}])`;
      }
      return 'z.string()';
    }

    case 'any':
      return 'z.any()';

    case 'never':
      return 'z.never()';

    case 'null':
      return 'z.null()';

    case 'literal': {
      if (def.value !== undefined) {
        const v = def.value;
        if (typeof v === 'string') return `z.literal(${JSON.stringify(v)})`;
        if (typeof v === 'number' || typeof v === 'boolean') return `z.literal(${v})`;
        if (v === null) return 'z.null()';
        return `z.literal(${JSON.stringify(v)})`;
      }
      if (def.values && Array.isArray(def.values) && def.values.length > 0) {
        const literals = def.values
          .map((v) => {
            if (typeof v === 'string') return `z.literal(${JSON.stringify(v)})`;
            if (typeof v === 'number' || typeof v === 'boolean')
              return `z.literal(${v})`;
            if (v === null) return 'z.null()';
            return `z.literal(${JSON.stringify(v)})`;
          })
          .join(', ');
        return `z.union([${literals}])`;
      }
      log?.debug(`zodDefToZodSchemaCode: Literal has no value/values.`);
      return 'z.any()';
    }

    case 'optional':
      return def.innerType
        ? `${zodDefToZodSchemaCode(def.innerType, log)}.optional()`
        : 'z.any().optional()';

    case 'nonoptional':
      return def.innerType
        ? `${zodDefToZodSchemaCode(def.innerType, log)}`
        : 'z.any()';

    case 'default':
      if (!def.innerType) return 'z.any()';
      const inner = zodDefToZodSchemaCode(def.innerType, log);
      const defaultValue = (def as { defaultValue?: unknown }).defaultValue;
      if (defaultValue === undefined) return `${inner}.optional()`;
      const defaultStr =
        typeof defaultValue === 'string'
          ? JSON.stringify(defaultValue)
          : typeof defaultValue === 'number' ||
              typeof defaultValue === 'boolean' ||
              defaultValue === null
            ? String(defaultValue)
            : JSON.stringify(defaultValue);
      return `${inner}.default(${defaultStr})`;

    case 'nullable':
      return def.innerType
        ? `${zodDefToZodSchemaCode(def.innerType, log)}.nullable()`
        : 'z.any().nullable()';

    case 'lazy':
      if (def.getter && typeof def.getter === 'function') {
        try {
          const innerDef = def.getter();
          const innerCode = zodDefToZodSchemaCode(innerDef, log);
          return `z.lazy(() => ${innerCode})`;
        } catch {
          log?.debug(`zodDefToZodSchemaCode: Lazy getter failed.`);
          return 'z.any()';
        }
      }
      return 'z.any()';

    case 'array':
      const elementCode = def.element
        ? zodDefToZodSchemaCode(def.element, log)
        : 'z.any()';
      return `z.array(${elementCode})`;

    case 'object':
      if (!def.shape) {
        log?.debug(`zodDefToZodSchemaCode: Object has no shape.`);
        return 'z.record(z.any())';
      }
      const shapeEntries = Object.entries(def.shape)
        .map(([key, value]) => {
          const code = zodDefToZodSchemaCode(value, log);
          const optional =
            value.def?.type === 'optional' || value.def?.type === 'default';
          const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
            ? key
            : JSON.stringify(key);
          return `${safeKey}: ${optional ? code : code}`;
        })
        .join(', ');
      return `z.object({ ${shapeEntries} })`;

    case 'union':
      if (!def.options || !Array.isArray(def.options)) {
        log?.debug(`zodDefToZodSchemaCode: Union has no options.`);
        return 'z.any()';
      }
      const optionsCode = def.options
        .map((opt) => zodDefToZodSchemaCode(opt, log))
        .join(', ');
      return `z.union([${optionsCode}])`;

    case 'void':
      return 'z.void()';

    case 'pipe': {
      const pipeIn = def.in;
      const pipeOut = def.out;
      if (pipeOut?.def?.type !== 'transform' && pipeOut) {
        return zodDefToZodSchemaCode(pipeOut, log);
      }
      if (pipeIn) {
        return zodDefToZodSchemaCode(pipeIn, log);
      }
      log?.debug(`zodDefToZodSchemaCode: Pipe has no in/out.`);
      return 'z.any()';
    }

    default:
      log?.debug(
        `zodDefToZodSchemaCode: Unhandled type "${def.type}", using z.any().`,
      );
      return 'z.any()';
  }
}
