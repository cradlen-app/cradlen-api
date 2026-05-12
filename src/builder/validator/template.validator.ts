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

/**
 * Server-side template-aware validator. Reads only the server-relevant
 * predicate effects (`required`, `forbidden`) and enforces them against the
 * submitted payload. `visible` and `enabled` predicates are ignored on the
 * server — Comment-9 invariant.
 *
 * Endpoints invoke this after class-validator finishes type-shape checks:
 *
 *   const result = await validator.validatePayload('obgyn_book_visit', body);
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
  ): Promise<ValidationResult> {
    const row = await this.templates.findActiveByCode(templateCode);
    const rendered = this.renderer.render(row);
    const ctx = new TemplateExecutionContext(rendered.sections, payload);
    const errors: ValidationError[] = [];

    for (const section of rendered.sections) {
      for (const field of section.fields) {
        this.evaluateField(ctx, field, errors);
      }
    }

    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  private evaluateField(
    ctx: TemplateExecutionContext,
    field: FieldDescriptor,
    out: ValidationError[],
  ): void {
    const predicates: Predicate[] = field.config?.logic?.predicates ?? [];
    const value = ctx.values[field.code];
    const isPresent = !(value === undefined || value === null || value === '');

    // Static `required: true` on the field (column-level) is the always-on case.
    if (field.required && !isPresent) {
      out.push({
        fieldCode: field.code,
        code: 'REQUIRED',
        message: `${field.code} is required`,
      });
      return;
    }

    for (const pred of predicates) {
      if (
        pred.effect === 'required' &&
        ctx.hasEffect(field, 'required') &&
        !isPresent
      ) {
        out.push({
          fieldCode: field.code,
          code: 'REQUIRED',
          message: pred.message ?? `${field.code} is required by template rule`,
        });
        // Don't push duplicate REQUIRED errors for the same field.
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
