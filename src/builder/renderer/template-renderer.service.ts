import { Injectable } from '@nestjs/common';
import type {
  BindingNamespace,
  FormField,
  FormSection,
  FormTemplate,
} from '@prisma/client';
import { ConfigShape } from '../fields/field-config.schema.js';
import { FieldDescriptor, SectionDescriptor } from '../sections/section.descriptor.js';

/**
 * Shape returned by `GET /v1/form-templates/:code` after the renderer hydrates
 * raw Prisma rows. The DB columns the frontend doesn't care about
 * (`is_deleted`, `created_by_id`, internal versioning fields) are stripped.
 */
export interface RenderedTemplate {
  id: string;
  code: string;
  name: string;
  description: string | null;
  scope: string;
  version: number;
  activated_at: Date | null;
  specialty_id: string | null;
  sections: SectionDescriptor[];
}

export type HydratableTemplate = FormTemplate & {
  sections: Array<FormSection & { fields: FormField[] }>;
};

@Injectable()
export class TemplateRendererService {
  render(template: HydratableTemplate): RenderedTemplate {
    return {
      id: template.id,
      code: template.code,
      name: template.name,
      description: template.description,
      scope: template.scope,
      version: template.version,
      activated_at: template.activated_at,
      specialty_id: template.specialty_id,
      sections: [...template.sections]
        .sort((a, b) => a.order - b.order)
        .map((section) => this.renderSection(section)),
    };
  }

  private renderSection(
    section: FormSection & { fields: FormField[] },
  ): SectionDescriptor {
    return {
      id: section.id,
      code: section.code,
      name: section.name,
      order: section.order,
      config: section.config as ConfigShape,
      fields: [...section.fields]
        .sort((a, b) => a.order - b.order)
        .map((field) => this.renderField(field)),
    };
  }

  private renderField(field: FormField): FieldDescriptor {
    return {
      id: field.id,
      code: field.code,
      label: field.label,
      type: field.type,
      order: field.order,
      required: field.required,
      binding: {
        namespace: field.binding_namespace as BindingNamespace | null,
        path: field.binding_path,
      },
      config: field.config as ConfigShape,
    };
  }
}
