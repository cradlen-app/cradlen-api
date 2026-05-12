# Builder rules

Single rule source for the whole DSL. Each `FormField.config.logic.predicates`
entry is a `Predicate` that frontend and server both evaluate via the same
`evaluate()` function.

## Operators (v1 — deliberately tiny)

| Op    | Shape                                | Semantics                                    |
|-------|--------------------------------------|----------------------------------------------|
| `eq`  | `{ eq: { fieldCode: value, ... } }`  | Every key equals exactly.                    |
| `ne`  | `{ ne: { fieldCode: value, ... } }`  | Every key NOT equal.                         |
| `in`  | `{ in: { fieldCode: [v1, v2] } }`    | Every key's value is in the list.            |
| `and` | `{ and: [Predicate, Predicate] }`    | All sub-conditions true.                     |
| `or`  | `{ or: [Predicate, Predicate] }`     | At least one sub-condition true.             |

Adding an operator is a cross-cutting change (frontend mirror, evaluator,
this doc). Don't add one casually.

## Effects → consumer table

| Effect       | Frontend | Server | Notes                                            |
|--------------|----------|--------|--------------------------------------------------|
| `visible`    | yes      | no     | UI-only. Server validates payloads even when UI hid the field. |
| `required`   | yes      | yes    | Same predicate, same evaluator, both sides.       |
| `forbidden`  | yes      | yes    | Replaces a "@MutuallyExclusiveNamespaces"-style decorator. |
| `enabled`    | yes      | no     | UI disabled state only.                           |

The server NEVER consumes `visible` or `enabled`. A hidden-in-UI field can
still be rejected by the server if its `required` predicate is true. This is
the Comment-9 invariant — never trust visibility for data integrity.

## Discriminator state-reset

A field with `config.logic.is_discriminator: true` (e.g. `visitor_type`)
triggers a frontend state reset: every `formValues` entry whose owning
field has a data-bearing namespace AND the entire `searchState` map are
cleared on change. Only `SYSTEM`-namespace values survive.

Server defence is symmetric: `effect: 'forbidden'` predicates emitted by
the seed on cross-namespace fields catch any leakage that slips past a
broken frontend.
