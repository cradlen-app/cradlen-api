/**
 * Single rule source for the builder DSL.
 *
 * Every conditional rule a field or section carries (visible / required /
 * forbidden / enabled) is a `Predicate`. The frontend and the server validator
 * read the same predicates and run them through the same evaluator
 * (`predicate.evaluator.ts`), so there is no place for a `visible_when` +
 * `required_when` + `@ValidateIf` drift trap.
 */

export type PredicateCondition =
  | { eq: Record<string, unknown> }
  | { in: Record<string, unknown[]> }
  | { ne: Record<string, unknown> }
  | { and: PredicateCondition[] }
  | { or: PredicateCondition[] };

/**
 * Server enforces only `required` and `forbidden`. `visible` and `enabled`
 * are UI affordances — a hidden field can still be rejected by the server if
 * its `required` predicate evaluates true.
 */
export type PredicateEffect =
  | 'visible'
  | 'required'
  | 'forbidden'
  | 'enabled';

export interface Predicate {
  effect: PredicateEffect;
  when: PredicateCondition;
  /** Optional human-readable error / hint surfaced by both UI and server. */
  message?: string;
}

export const SERVER_RELEVANT_EFFECTS: ReadonlySet<PredicateEffect> = new Set([
  'required',
  'forbidden',
]);
