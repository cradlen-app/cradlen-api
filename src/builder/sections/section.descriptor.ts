import { BindingNamespace, FormFieldType } from '@prisma/client';
import { ConfigShape } from '../fields/field-config.schema.js';

/**
 * Internal shape the renderer walks. Mirrors the Prisma model rows minus the
 * audit columns; consumers should pass `FormTemplate` rows from
 * `templates.service` through the renderer to get this shape out the other side.
 */
export interface SectionDescriptor {
  id: string;
  code: string;
  name: string;
  order: number;
  config: ConfigShape;
  fields: FieldDescriptor[];
}

export interface FieldDescriptor {
  id: string;
  code: string;
  label: string;
  type: FormFieldType;
  order: number;
  required: boolean;
  binding: {
    namespace: BindingNamespace | null;
    path: string | null;
  };
  config: ConfigShape;
}
