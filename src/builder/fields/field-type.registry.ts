import { BindingNamespace, FormFieldType } from '@prisma/client';
import { ConfigShape, InvalidConfigError } from './field-config.schema.js';
import { isKnownEntityKind } from './entity.registry.js';

/**
 * Per-field-type descriptor. Declares which `BindingNamespace`s a field of
 * this type may use and any per-type `config` invariants. The seed and the
 * server validator both consult this — when you add a new `FormFieldType`,
 * one entry here plus an `ALLOWED_PATHS` row is everything needed.
 */
export interface FieldTypeDescriptor {
  type: FormFieldType;
  allowedNamespaces: ReadonlySet<BindingNamespace>;
  /**
   * Per-type config validation. Runs *after* the generic `ConfigShape`
   * validator, so the namespaces are already known to be `{ui, validation, logic}`.
   */
  assertConfig?: (config: ConfigShape, contextLabel: string) => void;
}

const ALL_NS: readonly BindingNamespace[] = [
  'PATIENT',
  'VISIT',
  'INTAKE',
  'GUARDIAN',
  'MEDICAL_REP',
  'LOOKUP',
  'SYSTEM',
  'COMPUTED',
  'PATIENT_OBGYN_HISTORY',
  'VISIT_ENCOUNTER',
  'VISIT_VITALS',
  'VISIT_OBGYN_ENCOUNTER',
  'VISIT_INVESTIGATION',
  'VISIT_DIAGNOSIS',
  'PRESCRIPTION_ITEM',
  'MEDICAL_REP_VISIT',
];

function assertSelectOptions(config: ConfigShape, label: string) {
  // A SELECT/MULTISELECT must declare its option source one of two ways:
  //   - `validation.options`: static list resolved at render time
  //   - `ui.optionsSource`:   URL the frontend hits for dynamic suggestions
  //                           (e.g. medications, organization-scoped catalogs)
  // Exactly one is required. Both being empty is a malformed field.
  const options = config.validation?.options;
  const optionsSource = config.ui?.optionsSource;
  const hasStaticOptions = Array.isArray(options) && options.length > 0;
  const hasDynamicSource =
    typeof optionsSource === 'string' && optionsSource.length > 0;

  if (!hasStaticOptions && !hasDynamicSource) {
    throw new InvalidConfigError(
      `${label}: SELECT/MULTISELECT requires either a non-empty config.validation.options array or a config.ui.optionsSource URL`,
    );
  }
  if (hasStaticOptions) {
    for (const opt of options) {
      if (
        !opt ||
        typeof opt !== 'object' ||
        typeof opt.code !== 'string' ||
        typeof opt.label !== 'string'
      ) {
        throw new InvalidConfigError(
          `${label}: each option must be {code: string, label: string}`,
        );
      }
    }
  }
}

function assertEntitySearch(config: ConfigShape, label: string) {
  const entity = config.logic?.entity;
  if (typeof entity !== 'string') {
    throw new InvalidConfigError(
      `${label}: ENTITY_SEARCH requires config.logic.entity (string)`,
    );
  }
  if (!isKnownEntityKind(entity)) {
    throw new InvalidConfigError(
      `${label}: ENTITY_SEARCH config.logic.entity="${entity}" is not registered. Add it to ENTITIES in entity.registry.ts.`,
    );
  }
}

const ALLOWED_AUTOCOMPLETE_ENDPOINTS: ReadonlySet<string> = new Set([
  '/v1/medical-reps/companies',
]);

function assertTextConfig(config: ConfigShape, label: string) {
  const endpoint = config.ui?.autocompleteEndpoint;
  if (endpoint !== undefined) {
    if (typeof endpoint !== 'string' || endpoint.length === 0) {
      throw new InvalidConfigError(
        `${label}: config.ui.autocompleteEndpoint must be a non-empty string`,
      );
    }
    if (!ALLOWED_AUTOCOMPLETE_ENDPOINTS.has(endpoint)) {
      throw new InvalidConfigError(
        `${label}: config.ui.autocompleteEndpoint "${endpoint}" is not in the allowlist. ` +
          `Add it to ALLOWED_AUTOCOMPLETE_ENDPOINTS in field-type.registry.ts.`,
      );
    }
  }
}

function assertComputed(config: ConfigShape, label: string) {
  if (typeof config.logic?.formula !== 'string') {
    throw new InvalidConfigError(
      `${label}: COMPUTED requires config.logic.formula (string)`,
    );
  }
  const derivedFrom = config.ui?.derivedFrom;
  if (!Array.isArray(derivedFrom) || derivedFrom.length === 0) {
    throw new InvalidConfigError(
      `${label}: COMPUTED requires config.ui.derivedFrom (non-empty string[])`,
    );
  }
}

export const FIELD_TYPES: Record<FormFieldType, FieldTypeDescriptor> = {
  TEXT: {
    type: 'TEXT',
    allowedNamespaces: new Set(ALL_NS),
    assertConfig: assertTextConfig,
  },
  TEXTAREA: { type: 'TEXTAREA', allowedNamespaces: new Set(ALL_NS) },
  NUMBER: { type: 'NUMBER', allowedNamespaces: new Set(ALL_NS) },
  DECIMAL: { type: 'DECIMAL', allowedNamespaces: new Set(ALL_NS) },
  DATE: { type: 'DATE', allowedNamespaces: new Set(ALL_NS) },
  DATETIME: { type: 'DATETIME', allowedNamespaces: new Set(ALL_NS) },
  BOOLEAN: { type: 'BOOLEAN', allowedNamespaces: new Set(ALL_NS) },
  SELECT: {
    type: 'SELECT',
    allowedNamespaces: new Set(ALL_NS),
    assertConfig: assertSelectOptions,
  },
  MULTISELECT: {
    type: 'MULTISELECT',
    allowedNamespaces: new Set(ALL_NS),
    assertConfig: assertSelectOptions,
  },
  ENTITY_SEARCH: {
    type: 'ENTITY_SEARCH',
    allowedNamespaces: new Set<BindingNamespace>([
      'LOOKUP',
      'VISIT',
      'MEDICAL_REP',
      'PATIENT_OBGYN_HISTORY',
      'VISIT_INVESTIGATION',
      'VISIT_DIAGNOSIS',
      'PRESCRIPTION_ITEM',
      'VISIT_ENCOUNTER',
    ]),
    assertConfig: assertEntitySearch,
  },
  COMPUTED: {
    type: 'COMPUTED',
    allowedNamespaces: new Set<BindingNamespace>(['COMPUTED']),
    assertConfig: assertComputed,
  },
};

export function getFieldTypeDescriptor(
  type: FormFieldType,
): FieldTypeDescriptor {
  return FIELD_TYPES[type];
}
