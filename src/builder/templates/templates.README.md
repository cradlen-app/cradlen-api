# Builder — form templates

DB-backed form schema that the frontend hydrates into rendered UI. Authored
in `prisma/seed.ts`, never via admin endpoints — templates are code-managed.

## Read API

| Endpoint                                            | Returns                                  |
|-----------------------------------------------------|------------------------------------------|
| `GET /v1/form-templates`                            | Active published templates (summary)      |
| `GET /v1/form-templates/:code`                      | The active version (hydrated, ordered)    |
| `GET /v1/form-templates/:code/versions/:version`    | A specific version (for stale-cache reads during rollback) |

Active resolution is `WHERE code=? AND is_active=true AND is_deleted=false`
— **never** `max(version)`. The DB-level partial unique index
`(code) WHERE is_active=true AND is_deleted=false` guarantees a single active
row per code.

## Binding contract

Every field carries `binding: { namespace, path }`. Namespaces and their
submitted-or-not status:

| Namespace     | Submitted? | Frontend writes value into                              | Endpoint / persisted by                                                              |
|---------------|------------|----------------------------------------------------------|--------------------------------------------------------------------------------------|
| `PATIENT`     | yes        | `BookVisitDto.<path>`                                    | `POST /v1/visits/book` → Patient row                                                 |
| `VISIT`       | yes        | `BookVisitDto.<path>`                                    | `POST /v1/visits/book` → Visit row                                                   |
| `INTAKE`      | yes        | `BookVisitDto.<path>` (under `chief_complaint*`/`vitals.*`) | `POST /v1/visits/book` → VisitEncounter + VisitVitals                                |
| `GUARDIAN`    | yes        | `BookVisitDto.spouse_<path>`                             | `POST /v1/visits/book` → Guardian + PatientGuardian (SPOUSE)                         |
| `MEDICAL_REP` | yes        | `BookMedicalRepVisitDto.<path>`                          | `POST /v1/medical-rep-visits/book` → MedicalRep + MedicalRepVisit                    |
| `LOOKUP`      | yes (id)   | `BookVisitDto.patient_id` / `BookMedicalRepVisitDto.medical_rep_id` | server resolves the ID; sibling identity fields become forbidden                     |
| `SYSTEM`      | **no**     | client memory only (drives predicates + endpoint choice) | not persisted, never in any DTO                                                      |
| `COMPUTED`    | sent but ignored | computed in UI for display                          | server recomputes on persist (BMI from weight/height)                                |

Endpoint routing: the frontend reads `visitor_type` (the `SYSTEM`-bound
discriminator). PATIENT → `/v1/visits/book` with the PATIENT/VISIT/INTAKE/
GUARDIAN/LOOKUP→patient_id fields. MEDICAL_REP → `/v1/medical-rep-visits/book`
with the MEDICAL_REP/LOOKUP→medical_rep_id fields.

## Search-field lifecycle (ENTITY_SEARCH)

Search fields are **dual-state**. The frontend MUST keep two buckets and
never merge them:

```
formValues:   Record<fieldCode, primitive | null>          // submitted as-is
searchState:  Record<fieldCode, {
  transientValue:    string;                  // input box content
  suggestions:       EntityResult[];          // last server response
  resolvedEntityId:  { id: string; label: string } | null;
}>
```

Only `resolvedEntityId.id` is submitted — placed at the field's
`binding.path`. `transientValue` is discarded on blur-without-selection,
on submit, and on discriminator change.

## Discriminator state-reset rule

When any field with `config.logic.is_discriminator: true` changes value
(notably `visitor_type`), the frontend MUST clear:

- All `formValues` entries whose owning field's namespace is in
  `{PATIENT, VISIT, INTAKE, GUARDIAN, MEDICAL_REP, LOOKUP, COMPUTED}`
- The entire `searchState` map

Only `SYSTEM`-namespace state survives. Server defence is symmetric —
`effect: 'forbidden'` predicates emitted by the seed on cross-namespace
fields catch any leakage that slips past a broken frontend.

## UI visibility never gates server validation

`effect: 'visible'` and `effect: 'enabled'` predicates are UI-only. The
server validator ignores them entirely and enforces `required` /
`forbidden` independently. A field that's hidden in the current UI state
can still be 400-rejected by the server if its `required` predicate is
true. Treat the UI layer as a courtesy, not a gate.

## Governance

Templates are **code-managed, not admin-managed**. `prisma/seed.ts` is the
source of truth. There are no PATCH/POST/DELETE admin endpoints for
templates. Every change ships as a git commit + seed re-run + migration
replay. Direct DB edits in production are explicitly disallowed.

Activation is atomic — see the seed for the
`updateMany(active=false) → update(active=true)` transaction. The partial
unique index makes a race fail loudly rather than silently double-serve.

## Composition (shell + extension)

A template can declare a `parent_template_id` and `extension_key`, making it
an **extension** of another template (the **shell**). The endpoint
`GET /v1/form-templates/:code?extension=<KEY>` returns the shell composed
with the active extension matching that key under that shell. Without
`?extension=`, the raw shell is returned.

**Merge rule (override + append hybrid):**

- An extension section whose `code` matches a shell section REPLACES the
  shell section at the shell's position. The shell's `order` is preserved;
  the extension contributes content only.
- An extension section whose `code` does not appear in the shell is APPENDED
  in extension declaration order after all shell sections.
- Field-level merging is not supported — section is the merge unit.

**Discriminator:** the shell carries a SYSTEM-bound `specialty_code` field
(parallel to the existing `visitor_type`). Extensions auto-emit a
`forbidden when specialty_code != <key>` predicate on every contained field,
so the server rejects extension fields submitted under the wrong specialty
even if the client sends them.

**Versioning (bundled activation):** the orchestrator seed for a shell and
its known extensions performs activation in a single `$transaction` — there
is no intermediate state where a shell is active without its extensions.
Adding a new extension version means re-seeding the bundle (see
`prisma/seeds/book-visit.ts`).

**Listing:** `GET /v1/form-templates` returns only shells (rows with
`parent_template_id IS NULL`). Extensions are not standalone listings.

**Lookup invariants:**

- Active shell: `WHERE code=? AND is_active AND NOT is_deleted AND parent_template_id IS NULL`.
- Active extension: `WHERE parent_template_id=? AND extension_key=? AND is_active AND NOT is_deleted`.
- DB enforces both via partial unique indexes; the symmetry CHECK guarantees
  `(parent_template_id IS NULL) = (extension_key IS NULL)`.
