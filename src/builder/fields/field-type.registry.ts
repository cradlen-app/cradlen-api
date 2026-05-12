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
];

function assertSelectOptions(config: ConfigShape, label: string) {
  const options = config.validation?.options;
  if (!Array.isArray(options) || options.length === 0) {
    throw new InvalidConfigError(
      `${label}: SELECT/MULTISELECT requires config.validation.options to be a non-empty array of {code, label}`,
    );
  }
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
  TEXT: { type: 'TEXT', allowedNamespaces: new Set(ALL_NS) },
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
    allowedNamespaces: new Set<BindingNamespace>(['LOOKUP', 'VISIT', 'MEDICAL_REP']),
    assertConfig: assertEntitySearch,
  },
  COMPUTED: {
    type: 'COMPUTED',
    allowedNamespaces: new Set<BindingNamespace>(['COMPUTED']),
    assertConfig: assertComputed,
  },
};

export function getFieldTypeDescriptor(type: FormFieldType): FieldTypeDescriptor {
  return FIELD_TYPES[type];
}
