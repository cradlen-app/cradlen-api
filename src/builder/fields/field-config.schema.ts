import { Predicate } from '../rules/predicates.js';

/**
 * Namespaced `config` shape used by both `FormSection.config` and
 * `FormField.config`. The three buckets prevent the "junk drawer" smell —
 * authors must place new keys into `ui`, `validation`, or `logic` rather
 * than scattering at the top level.
 */
export interface ConfigShape {
  ui?: {
    placeholder?: string;
    helpText?: string;
    optionsSource?: string;
    derivedFrom?: string[];
    hidden?: boolean;
    /**
     * Turns a plain TEXT field into an autocomplete that searches an entity
     * registered in `ENTITIES`. On pick, the frontend fills the form id field
     * named by `idTarget` with the selected entity's id and copies the entity
     * fields listed in `fillFields` onto the matching form-field codes.
     *
     * `allowCreate` opts the field into lookup-or-create semantics: when the
     * user types a value and submits without picking a suggestion, the typed
     * text is preserved at the host field's own `binding.path` so the server
     * can take the "new entity" branch. When `allowCreate` is absent/false,
     * the typed text is discarded on blur-without-selection (lookup-only).
     */
    searchEntity?: {
      kind: string;
      idTarget: string;
      fillFields?: Record<string, string>;
      allowCreate?: boolean;
      /**
       * Resolves a sibling ENTITY_SEARCH field from the same raw payload. Keyed
       * by the target search field's `code`. Used e.g. to pre-resolve the
       * spouse guardian search when an existing patient is picked.
       */
      fillEntitySearches?: Record<
        string,
        {
          idSource: string;
          labelSource: string;
          fillFields?: Record<string, string>;
        }
      >;
    };
    [k: string]: unknown;
  };
  validation?: {
    min?: number;
    max?: number;
    maxLength?: number;
    pattern?: string;
    options?: Array<{ code: string; label: string }>;
    [k: string]: unknown;
  };
  logic?: {
    predicates?: Predicate[];
    is_discriminator?: boolean;
    formula?: string;
    entity?: string;
    [k: string]: unknown;
  };
}

export class InvalidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConfigError';
  }
}

/**
 * Validates `config` against the namespaced shape. Throws on flat top-level
 * keys, non-object namespaces, or a `logic.predicates` value that isn't an
 * array. Pure-TS — no Zod dependency.
 */
export function assertValidConfig(
  config: unknown,
  contextLabel: string,
): asserts config is ConfigShape {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new InvalidConfigError(
      `${contextLabel}: config must be an object, got ${describe(config)}`,
    );
  }
  const ALLOWED_TOP_KEYS = new Set(['ui', 'validation', 'logic']);
  for (const key of Object.keys(config)) {
    if (!ALLOWED_TOP_KEYS.has(key)) {
      throw new InvalidConfigError(
        `${contextLabel}: unknown top-level config key "${key}". ` +
          `Place it under one of: ${[...ALLOWED_TOP_KEYS].join(', ')}.`,
      );
    }
    const value = (config as Record<string, unknown>)[key];
    if (
      value !== undefined &&
      (typeof value !== 'object' || value === null || Array.isArray(value))
    ) {
      throw new InvalidConfigError(
        `${contextLabel}: config.${key} must be an object, got ${describe(value)}`,
      );
    }
  }
  const logic = (config as ConfigShape).logic;
  if (logic?.predicates !== undefined && !Array.isArray(logic.predicates)) {
    throw new InvalidConfigError(
      `${contextLabel}: config.logic.predicates must be an array`,
    );
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
