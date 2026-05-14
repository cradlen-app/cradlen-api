import { Injectable } from '@nestjs/common';
import { TemplatesService } from '../templates/templates.service.js';
import { TemplateRendererService } from '../renderer/template-renderer.service.js';
import { TemplateExecutionContext } from '../runtime/template-execution.context.js';
import { Predicate } from '../rules/predicates.js';
import { FieldDescriptor } from '../sections/section.descriptor.js';

export interface ValidationError {
  fieldCode: string;
  code: 'REQUIRED' | 'FORBIDDEN';
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

export interface ValidatePayloadOptions {
  /**
   * Compose the active extension matching this key onto the shell before
   * validation. Required when the template defines specialty-specific
   * sections that must be enforced server-side.
   */
  extensionKey?: string | null;
  /**
   * PATCH semantics: skip column-level required AND required-when predicates.
   * Forbidden predicates still fire for fields present in the payload so a
   * client cannot patch in cross-discriminator data. Use on update endpoints.
   */
  sparse?: boolean;
}

/**
 * Server-side template-aware validator. Reads only the server-relevant
 * predicate effects (`required`, `forbidden`) and enforces them against the
 * submitted payload. `visible` and `enabled` predicates are ignored on the
 * server — Comment-9 invariant.
 *
 * Endpoints invoke this after class-validator finishes type-shape checks:
 *
 *   const result = await validator.validatePayload('book_visit', body, {
 *     extensionKey: 'OBGYN',
 *   });
 *   if (!result.ok) throw new BadRequestException({ fields: result.errors });
 */
@Injectable()
export class TemplateValidator {
  constructor(
    private readonly templates: TemplatesService,
    private readonly renderer: TemplateRendererService,
  ) {}

  async validatePayload(
    templateCode: string,
    payload: Record<string, unknown>,
    options: ValidatePayloadOptions = {},
  ): Promise<ValidationResult> {
    const row = options.extensionKey
      ? await this.templates.findActiveComposed(
          templateCode,
          options.extensionKey,
        )
      : await this.templates.findActiveByCode(templateCode);
    const rendered = this.renderer.render(row);
    const ctx = new TemplateExecutionContext(rendered.sections, payload);
    const errors: ValidationError[] = [];

    for (const section of rendered.sections) {
      for (const field of section.fields) {
        this.evaluateField(ctx, field, options.sparse === true, errors);
      }
    }

    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  private evaluateField(
    ctx: TemplateExecutionContext,
    field: FieldDescriptor,
    sparse: boolean,
    out: ValidationError[],
  ): void {
    const predicates: Predicate[] = field.config?.logic?.predicates ?? [];
    const value = ctx.values[field.code];
    const isPresent = !(value === undefined || value === null || value === '');

    if (!sparse && field.required && !isPresent) {
      out.push({
        fieldCode: field.code,
        code: 'REQUIRED',
        message: `${field.code} is required`,
      });
      return;
    }

    for (const pred of predicates) {
      if (
        !sparse &&
        pred.effect === 'required' &&
        ctx.hasEffect(field, 'required') &&
        !isPresent
      ) {
        out.push({
          fieldCode: field.code,
          code: 'REQUIRED',
          message: pred.message ?? `${field.code} is required by template rule`,
        });
        return;
      }
      if (
        pred.effect === 'forbidden' &&
        ctx.hasEffect(field, 'forbidden') &&
        isPresent
      ) {
        out.push({
          fieldCode: field.code,
          code: 'FORBIDDEN',
          message:
            pred.message ??
            `${field.code} must not be present under current selection`,
        });
        return;
      }
    }
  }
}
