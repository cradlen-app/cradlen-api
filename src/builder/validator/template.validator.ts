import { Injectable } from '@nestjs/common';
import { TemplatesService } from '../templates/templates.service.js';
import { TemplateRendererService } from '../renderer/template-renderer.service.js';
import { TemplateExecutionContext } from '../runtime/template-execution.context.js';
import { Predicate } from '../rules/predicates.js';
import { evaluate } from '../rules/predicate.evaluator.js';
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

    // Display-only templates (e.g. the OB/GYN patient-history surface) are never
    // a write target. If a caller submits any field value against one, reject
    // outright — forward-looking guard for flows that compose such a template.
    if (rendered.is_display_only) {
      const hasAnyValue = rendered.sections.some((section) =>
        section.fields.some((field) => {
          const value = ctx.values[field.code];
          return !(value === undefined || value === null || value === '');
        }),
      );
      if (hasAnyValue) {
        return {
          ok: false,
          errors: [
            {
              fieldCode: '*',
              code: 'FORBIDDEN',
              message: `template "${templateCode}" is display-only and cannot be submitted`,
            },
          ],
        };
      }
      return { ok: true };
    }

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
    const value = ctx.values[field.code];
    const isPresent = !(value === undefined || value === null || value === '');

    // REQUIRED — column-level flag OR a triggered `required` predicate. Skipped
    // under sparse (PATCH) semantics. At most one REQUIRED error per field.
    if (!sparse && !isPresent) {
      if (field.required) {
        out.push({
          fieldCode: field.code,
          code: 'REQUIRED',
          message: `${field.code} is required`,
        });
        return;
      }
      const triggered = this.firstTriggered(ctx, field, 'required');
      if (triggered) {
        out.push({
          fieldCode: field.code,
          code: 'REQUIRED',
          message:
            triggered.message ?? `${field.code} is required by template rule`,
        });
        return;
      }
    }

    // FORBIDDEN — fires regardless of sparse, so a PATCH can't slip in
    // cross-discriminator data. At most one FORBIDDEN error per field.
    if (isPresent) {
      const triggered = this.firstTriggered(ctx, field, 'forbidden');
      if (triggered) {
        out.push({
          fieldCode: field.code,
          code: 'FORBIDDEN',
          message:
            triggered.message ??
            `${field.code} must not be present under current selection`,
        });
      }
    }
  }

  /**
   * Returns the first predicate of the given effect whose condition evaluates
   * true against the current payload, or `undefined` if none trigger. Used so
   * the surfaced message belongs to the rule that actually fired.
   */
  private firstTriggered(
    ctx: TemplateExecutionContext,
    field: FieldDescriptor,
    effect: Predicate['effect'],
  ): Predicate | undefined {
    const predicates: Predicate[] = field.config?.logic?.predicates ?? [];
    return predicates.find(
      (p) => p.effect === effect && evaluate(p.when, ctx.values),
    );
  }
}
