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
       * When true, the sibling fields named in `fillFields` are rendered
       * read-only once an entity is resolved. Opt-in: pickers whose filled
       * values are meant to be edited (e.g. medication default dose) omit it.
       */
      lockFilled?: boolean;
      /**
       * Narrows `lockFilled` to specific fill targets. When present, only the
       * listed field codes are rendered read-only on resolve (and `lockFilled`
       * is ignored). Use to keep immutable fields (e.g. `national_id`) locked
       * while leaving the rest of the prefilled identity editable.
       */
      lockFilledFields?: string[];
      /**
       * Resolves a sibling ENTITY_SEARCH field from the same raw payload. Keyed
       * by the target search field's `code`. Used to pre-resolve a dependent
       * entity-search picker when a parent entity is selected.
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
    /**
     * Signals the frontend renderer to fetch server-side suggestions as the
     * user types. The field value is still a plain string — no ID resolution.
     * Must be listed in `ALLOWED_AUTOCOMPLETE_ENDPOINTS` in field-type.registry.ts
     * or seed-time validation will throw.
     */
    autocompleteEndpoint?: string;
    /**
     * Dot-path into the existing entity response (visit, patient, …) that the
     * frontend should read in edit-mode to pre-populate this field's initial
     * value. Pure renderer hint — no server-side effect.
     * Example: `"specialty_code"` → reads `visit.specialty_code`.
     */
    prefillFrom?: string;
    [k: string]: unknown;
  };
  /**
   * Validation constraints. These are **server-enforced** by `TemplateValidator`
   * (in addition to being frontend rendering hints): when a field carries a
   * value, each present constraint is checked and a failure surfaces as a 400.
   * `min`/`max` apply to numeric fields, `minLength`/`maxLength`/`pattern` to
   * strings, and `notInFuture`/`maxAgeYears` to DATE/DATETIME fields.
   */
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    /** DATE/DATETIME: reject values after "now". */
    notInFuture?: boolean;
    /** DATE/DATETIME: reject values older than this many years before "now". */
    maxAgeYears?: number;
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
  /**
   * Per-locale translations overlaid by the renderer based on the request
   * locale. English is the base (the top-level `label`/`name`/`ui.placeholder`/
   * option labels); other locales supply overrides here. The renderer strips
   * this block from the wire — it never reaches the frontend.
   *
   * Field: `{ label?, placeholder?, helpText?, options?: { [optionCode]: string } }`.
   * Section: `{ name? }`.
   */
  i18n?: {
    [locale: string]: {
      label?: string;
      name?: string;
      placeholder?: string;
      helpText?: string;
      options?: Record<string, string>;
    };
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
  const ALLOWED_TOP_KEYS = new Set(['ui', 'validation', 'logic', 'i18n']);
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

  // A `validation.pattern` must compile to a RegExp — catch authoring typos at
  // seed time so a malformed regex can never reach the request-time validator.
  const pattern = (config as ConfigShape).validation?.pattern;
  if (pattern !== undefined) {
    if (typeof pattern !== 'string') {
      throw new InvalidConfigError(
        `${contextLabel}: config.validation.pattern must be a string`,
      );
    }
    try {
      new RegExp(pattern);
    } catch {
      throw new InvalidConfigError(
        `${contextLabel}: config.validation.pattern is not a valid regular expression: "${pattern}"`,
      );
    }
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
