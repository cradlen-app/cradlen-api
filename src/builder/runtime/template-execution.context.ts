import { FieldDescriptor, SectionDescriptor } from '../sections/section.descriptor.js';
import { Predicate, PredicateEffect } from '../rules/predicates.js';
import { evaluate } from '../rules/predicate.evaluator.js';

/**
 * Carries an in-flight payload plus convenience lookups used by the server-side
 * template validator. The frontend mirrors this shape (computed from the
 * rendered template DTO + the user's current values).
 *
 * Lookups are by field `code`, NOT by `binding.path`, because predicates
 * reference other fields by code (`{eq:{visitor_type:"PATIENT"}}` reads the
 * `visitor_type` field's current value).
 */
export class TemplateExecutionContext {
  private readonly fieldsByCode: Map<string, FieldDescriptor>;
  private readonly sectionsByCode: Map<string, SectionDescriptor>;
  private readonly valuesByCode: Record<string, unknown>;

  constructor(
    public readonly sections: readonly SectionDescriptor[],
    public readonly payload: Record<string, unknown>,
  ) {
    this.sectionsByCode = new Map(sections.map((s) => [s.code, s]));
    this.fieldsByCode = new Map();
    for (const section of sections) {
      for (const field of section.fields) {
        this.fieldsByCode.set(field.code, field);
      }
    }
    this.valuesByCode = this.indexPayloadByFieldCode();
  }

  /**
   * Maps the wire payload into a `Record<fieldCode, value>` that predicate
   * evaluator can read. Field values are looked up by following each field's
   * `binding.path` into the payload. Fields without a binding (or whose path
   * isn't in the payload) get `undefined`.
   */
  private indexPayloadByFieldCode(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of this.fieldsByCode.values()) {
      const path = field.binding.path;
      out[field.code] = path
        ? readDottedPath(this.payload, path)
        : undefined;
    }
    return out;
  }

  getField(code: string): FieldDescriptor | undefined {
    return this.fieldsByCode.get(code);
  }

  /**
   * True iff at least one predicate of the given effect on the field/section
   * evaluates true against the current payload.
   */
  hasEffect(carrier: { config: { logic?: { predicates?: Predicate[] } } }, effect: PredicateEffect): boolean {
    const preds = carrier.config?.logic?.predicates ?? [];
    return preds.some((p) => p.effect === effect && evaluate(p.when, this.valuesByCode));
  }

  /** Values keyed by field code (read-only view). */
  get values(): Readonly<Record<string, unknown>> {
    return this.valuesByCode;
  }
}

function readDottedPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}
