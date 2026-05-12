import { PredicateCondition } from './predicates.js';

/**
 * Pure-TS predicate evaluator. Called by the server validator and mirrored on
 * the frontend (when the web team imports the type via a generated `.d.ts`).
 *
 * Operator semantics (kept tiny on purpose — adding an operator is a
 * cross-cutting change that needs a deliberate decision):
 *   - `eq`:  every key must equal exactly.
 *   - `in`:  every key's value must appear in the list for that key.
 *   - `ne`:  every key must NOT equal.
 *   - `and`: all sub-conditions true.
 *   - `or`:  at least one sub-condition true.
 *
 * A missing key in `values` is treated as `undefined` — `eq:{x:'A'}` against
 * an empty payload is false, not an error.
 */
export function evaluate(
  condition: PredicateCondition,
  values: Record<string, unknown>,
): boolean {
  if ('eq' in condition) {
    return Object.entries(condition.eq).every(([k, v]) => values[k] === v);
  }
  if ('ne' in condition) {
    return Object.entries(condition.ne).every(([k, v]) => values[k] !== v);
  }
  if ('in' in condition) {
    return Object.entries(condition.in).every(([k, list]) =>
      list.includes(values[k]),
    );
  }
  if ('and' in condition) {
    return condition.and.every((sub) => evaluate(sub, values));
  }
  if ('or' in condition) {
    return condition.or.some((sub) => evaluate(sub, values));
  }
  // Exhaustiveness guard — unreachable if the input matches the union type.
  const _exhaustive: never = condition;
  void _exhaustive;
  return false;
}
