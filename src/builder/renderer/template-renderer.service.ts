import { Injectable } from '@nestjs/common';
import type {
  FormField,
  FormScope,
  FormSection,
  FormTemplate,
} from '@prisma/client';
import { ConfigShape } from '../fields/field-config.schema.js';
import {
  FieldDescriptor,
  SectionDescriptor,
} from '../sections/section.descriptor.js';

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
  scope: FormScope;
  version: number;
  activated_at: Date | null;
  /**
   * Display-only templates render read-only in the frontend (no input controls)
   * and are never a write target. e.g. the OB/GYN patient-history surface.
   */
  is_display_only: boolean;
  specialty_id: string | null;
  sections: SectionDescriptor[];
}

export type HydratableTemplate = FormTemplate & {
  sections: Array<FormSection & { fields: FormField[] }>;
};

const DEFAULT_LOCALE = 'en';

type LocaleStrings = NonNullable<ConfigShape['i18n']>[string];

@Injectable()
export class TemplateRendererService {
  /**
   * Hydrates raw Prisma rows into the wire shape. When `locale` is a non-default
   * supported locale, the per-field/section `config.i18n[locale]` translations
   * are overlaid onto `label`/`name`/`ui.placeholder`/option labels. The
   * `config.i18n` block is always stripped from the output (it never reaches the
   * frontend), for every locale.
   */
  render(
    template: HydratableTemplate,
    locale: string = DEFAULT_LOCALE,
  ): RenderedTemplate {
    return {
      id: template.id,
      code: template.code,
      name: template.name,
      description: template.description,
      scope: template.scope,
      version: template.version,
      activated_at: template.activated_at,
      is_display_only: template.is_display_only,
      specialty_id: template.specialty_id,
      sections: [...template.sections]
        .sort((a, b) => a.order - b.order)
        .map((section) => this.renderSection(section, locale)),
    };
  }

  private renderSection(
    section: FormSection & { fields: FormField[] },
    locale: string,
  ): SectionDescriptor {
    const { config, i18n } = this.localizeConfig(
      section.config as ConfigShape,
      locale,
    );
    return {
      id: section.id,
      code: section.code,
      name: i18n?.name ?? section.name,
      order: section.order,
      is_repeatable: section.is_repeatable,
      config,
      fields: [...section.fields]
        .sort((a, b) => a.order - b.order)
        .map((field) => this.renderField(field, locale)),
    };
  }

  private renderField(field: FormField, locale: string): FieldDescriptor {
    const { config, i18n } = this.localizeConfig(
      field.config as ConfigShape,
      locale,
    );
    return {
      id: field.id,
      code: field.code,
      label: i18n?.label ?? field.label,
      type: field.type,
      order: field.order,
      required: field.required,
      binding: {
        namespace: field.binding_namespace,
        path: field.binding_path,
      },
      config,
    };
  }

  /**
   * Returns a new config with `config.i18n` removed and, when `locale` has
   * translations, the localized `ui.placeholder` / `ui.helpText` /
   * `validation.options[].label` overlaid. Also returns the resolved locale
   * block so callers can pick up `label`/`name`. The source config is never
   * mutated.
   */
  private localizeConfig(
    source: ConfigShape | undefined,
    locale: string,
  ): { config: ConfigShape; i18n: LocaleStrings | undefined } {
    const { i18n: i18nMap, ...rest } = source ?? {};
    const tr = locale !== DEFAULT_LOCALE ? i18nMap?.[locale] : undefined;
    const config: ConfigShape = { ...rest };

    if (tr) {
      if (tr.placeholder !== undefined || tr.helpText !== undefined) {
        config.ui = {
          ...config.ui,
          ...(tr.placeholder !== undefined && { placeholder: tr.placeholder }),
          ...(tr.helpText !== undefined && { helpText: tr.helpText }),
        };
      }
      if (tr.options && config.validation?.options) {
        config.validation = {
          ...config.validation,
          options: config.validation.options.map((o) => ({
            ...o,
            label: tr.options?.[o.code] ?? o.label,
          })),
        };
      }
    }

    return { config, i18n: tr };
  }
}
