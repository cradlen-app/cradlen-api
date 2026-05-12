import { BindingNamespace } from '@prisma/client';

/**
 * The extension point that keeps `ENTITY_SEARCH` from becoming a Pokémon
 * registry of field types. Each searchable entity registers ONE descriptor
 * here; adding a new kind (lab, supplier, staff, ...) is one entry plus a
 * `GET /<resource>?search=` endpoint. No new `FormFieldType`, no new
 * `BindingNamespace`.
 */
export interface EntityDescriptor {
  /** Stable identifier referenced by `FormField.config.logic.entity`. */
  kind: string;
  /** GET endpoint the frontend hits for suggestions. */
  searchEndpoint: string;
  /** Tells the frontend how to render result rows in the dropdown. */
  resultShape: {
    idKey: string;
    labelKeys: string[];
    subtitleKeys?: string[];
  };
  /**
   * Where the resolved ID lives in the submitted DTO at submit time.
   * Frontend uses this with the field's `binding.path` to place the value.
   */
  submitTargetNamespace: BindingNamespace;
  submitTargetPath: string;
}

export const ENTITIES = {
  patient: {
    kind: 'patient',
    searchEndpoint: '/v1/patients?search=',
    resultShape: {
      idKey: 'id',
      labelKeys: ['full_name'],
      subtitleKeys: ['national_id', 'phone_number'],
    },
    submitTargetNamespace: 'LOOKUP',
    submitTargetPath: 'patient_id',
  },
  medical_rep: {
    kind: 'medical_rep',
    searchEndpoint: '/v1/medical-reps?search=',
    resultShape: {
      idKey: 'id',
      labelKeys: ['full_name'],
      subtitleKeys: ['company_name', 'national_id'],
    },
    submitTargetNamespace: 'LOOKUP',
    submitTargetPath: 'medical_rep_id',
  },
  doctor: {
    kind: 'doctor',
    // Filtered by an OBGYN/OTHER_DOCTOR job function at the endpoint.
    searchEndpoint: '/v1/profiles?role=doctor&search=',
    resultShape: {
      idKey: 'id',
      labelKeys: ['full_name'],
      subtitleKeys: ['job_functions'],
    },
    submitTargetNamespace: 'VISIT',
    submitTargetPath: 'assigned_doctor_id',
  },
} as const satisfies Record<string, EntityDescriptor>;

export type EntityKind = keyof typeof ENTITIES;

export function isKnownEntityKind(kind: string): kind is EntityKind {
  return kind in ENTITIES;
}

export function getEntityDescriptor(kind: string): EntityDescriptor {
  if (!isKnownEntityKind(kind)) {
    throw new Error(
      `Unknown entity kind "${kind}". Registered kinds: ${Object.keys(ENTITIES).join(', ')}`,
    );
  }
  return ENTITIES[kind];
}
