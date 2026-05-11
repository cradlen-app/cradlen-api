import { Injectable } from '@nestjs/common';

export type FieldType =
  | 'TEXT'
  | 'LONG_TEXT'
  | 'NUMBER'
  | 'INTEGER'
  | 'DATE'
  | 'DATETIME'
  | 'BOOLEAN'
  | 'SINGLE_SELECT'
  | 'MULTI_SELECT'
  | 'SECTION'
  | 'REPEATING_GROUP'
  | 'COMPUTED';

export interface FieldOption {
  code: string;
  label?: Record<string, string>;
}

export interface ShowIf {
  field: string;
  equals?: unknown;
  in?: unknown[];
}

export interface FieldSchema {
  code: string;
  type: FieldType;
  label?: Record<string, string>;
  required?: boolean;
  min?: number;
  max?: number;
  min_length?: number;
  max_length?: number;
  regex?: string;
  options?: FieldOption[];
  fields?: FieldSchema[];
  show_if?: ShowIf;
  expression?: string;
}

export interface SectionSchema {
  code: string;
  label?: Record<string, string>;
  fields: FieldSchema[];
  show_if?: ShowIf;
}

export interface FormSchema {
  sections: SectionSchema[];
}

export type ValidationErrors = Record<string, string[]>;

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrors;
  sanitized: Record<string, unknown>;
}

type Responses = Record<string, unknown>;

@Injectable()
export class FormSchemaValidatorService {
  validate(
    schema: FormSchema,
    responses: Responses | null | undefined,
  ): ValidationResult {
    const errors: ValidationErrors = {};
    const sanitized: Responses = {};
    const safe = responses ?? {};

    const allFields = collectTopLevelFields(schema);
    const context: Responses = { ...safe };

    for (const field of allFields) {
      if (!fieldIsVisible(field, context)) continue;
      if (field.type === 'SECTION') continue;
      if (field.type === 'COMPUTED') {
        // COMPUTED fields are never accepted from client input; stripped here.
        // Server-side recomputation is a follow-up (whitelisted expr evaluator).
        continue;
      }

      const value = safe[field.code];
      this.validateField(field, value, field.code, context, errors, sanitized);
    }

    return { valid: Object.keys(errors).length === 0, errors, sanitized };
  }

  private validateField(
    field: FieldSchema,
    value: unknown,
    path: string,
    context: Responses,
    errors: ValidationErrors,
    sanitized: Responses,
  ): void {
    const isEmpty = value === undefined || value === null || value === '';

    if (isEmpty) {
      if (field.required) {
        pushErr(errors, path, 'required');
      }
      return;
    }

    switch (field.type) {
      case 'TEXT':
      case 'LONG_TEXT':
        if (typeof value !== 'string') {
          pushErr(errors, path, 'must be a string');
          return;
        }
        if (field.min_length !== undefined && value.length < field.min_length) {
          pushErr(errors, path, `min length ${field.min_length}`);
        }
        if (field.max_length !== undefined && value.length > field.max_length) {
          pushErr(errors, path, `max length ${field.max_length}`);
        }
        if (field.regex !== undefined && !new RegExp(field.regex).test(value)) {
          pushErr(errors, path, 'invalid format');
        }
        sanitized[field.code] = value;
        return;

      case 'NUMBER':
      case 'INTEGER': {
        const num = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(num)) {
          pushErr(errors, path, 'must be a number');
          return;
        }
        if (field.type === 'INTEGER' && !Number.isInteger(num)) {
          pushErr(errors, path, 'must be an integer');
          return;
        }
        if (field.min !== undefined && num < field.min) {
          pushErr(errors, path, `min ${field.min}`);
        }
        if (field.max !== undefined && num > field.max) {
          pushErr(errors, path, `max ${field.max}`);
        }
        sanitized[field.code] = num;
        return;
      }

      case 'BOOLEAN':
        if (typeof value !== 'boolean') {
          pushErr(errors, path, 'must be boolean');
          return;
        }
        sanitized[field.code] = value;
        return;

      case 'DATE':
      case 'DATETIME':
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
          pushErr(errors, path, 'must be a valid ISO date');
          return;
        }
        sanitized[field.code] = value;
        return;

      case 'SINGLE_SELECT': {
        const allowed = (field.options ?? []).map((o) => o.code);
        if (typeof value !== 'string' || !allowed.includes(value)) {
          pushErr(errors, path, 'invalid option');
          return;
        }
        sanitized[field.code] = value;
        return;
      }

      case 'MULTI_SELECT': {
        if (!Array.isArray(value)) {
          pushErr(errors, path, 'must be an array');
          return;
        }
        const allowed = new Set((field.options ?? []).map((o) => o.code));
        const bad = (value as unknown[]).find(
          (v): v is string => typeof v !== 'string' || !allowed.has(v),
        );
        if (bad !== undefined) {
          pushErr(errors, path, 'invalid option in array');
          return;
        }
        sanitized[field.code] = value;
        return;
      }

      case 'REPEATING_GROUP': {
        if (!Array.isArray(value)) {
          pushErr(errors, path, 'must be an array');
          return;
        }
        const rows: Responses[] = [];
        value.forEach((row, idx) => {
          if (row === null || typeof row !== 'object' || Array.isArray(row)) {
            pushErr(errors, `${path}[${idx}]`, 'must be an object');
            return;
          }
          const sanitizedRow: Responses = {};
          const rowCtx = row as Responses;
          for (const child of field.fields ?? []) {
            if (!fieldIsVisible(child, rowCtx)) continue;
            if (child.type === 'COMPUTED' || child.type === 'SECTION') continue;
            this.validateField(
              child,
              rowCtx[child.code],
              `${path}[${idx}].${child.code}`,
              rowCtx,
              errors,
              sanitizedRow,
            );
          }
          rows.push(sanitizedRow);
        });
        sanitized[field.code] = rows;
        return;
      }

      case 'SECTION':
      case 'COMPUTED':
        return;
    }
  }
}

function pushErr(errors: ValidationErrors, path: string, msg: string): void {
  if (!errors[path]) errors[path] = [];
  errors[path].push(msg);
}

function collectTopLevelFields(schema: FormSchema): FieldSchema[] {
  const out: FieldSchema[] = [];
  for (const section of schema.sections ?? []) {
    for (const f of section.fields ?? []) out.push(f);
  }
  return out;
}

function fieldIsVisible(
  field: FieldSchema | SectionSchema,
  ctx: Responses,
): boolean {
  const cond = (field as { show_if?: ShowIf }).show_if;
  if (!cond) return true;
  const observed = ctx[cond.field];
  if (cond.in !== undefined) return cond.in.includes(observed);
  if (cond.equals !== undefined) return observed === cond.equals;
  return true;
}
