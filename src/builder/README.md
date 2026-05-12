# `builder/`

Engine for the dynamic clinical DSL: fields, sections, templates, workflows, and rules. Splits cleanly into **definitions** (what a form/workflow/rule *is*) and **execution** (how it runs against patient data at request time).

## Dependency rule

`builder → common, infrastructure.` Must never import from `core` or `plugins`. The DSL is content-agnostic; clinical concepts live in `core`. Enforced by `eslint.config.mjs`.

## Subfolders

### Definitions
| Folder | Purpose |
|--------|---------|
| `fields/` | Field type registry (text, number, vitals, dropdown, computed, …) |
| `sections/` | Grouping primitives — labelled blocks of fields |
| `templates/` | Form/visit/episode templates assembled from sections |
| `workflows/` | Workflow definition + states + transitions |
| `rules/` | Condition + action records evaluated at runtime |

### Execution
| Folder | Purpose |
|--------|---------|
| `runtime/` | `ExecutionContext`, `WorkflowEngine`, `RuleEngine` |
| `renderer/` | Hydrates a template into a renderable schema for the frontend |
| `validator/` | Validates submitted payloads against a template at request time |

## Status

Scaffold only — no implementation in this PR. The folder exists so future work has an obvious landing zone and the dependency rule is enforced from day one.
