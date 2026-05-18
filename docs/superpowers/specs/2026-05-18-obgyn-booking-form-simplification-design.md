# OB/GYN Booking Form Simplification

**Date:** 2026-05-18  
**Status:** Draft  
**Scope:** book_visit shell template (v8) + obgyn_book_visit_ext (v2) + supporting backend

---

## Context

The current booking form is used by reception staff, not doctors. It collects too much at booking time — vitals and detailed clinical intake belong in the encounter, not the booking step. Additionally, the medical rep flow has unnecessary identity fields that slow down reception.

This change:
- Strips the booking form down to what a receptionist actually needs
- Makes chief complaint categories dynamic (specialty + care_path aware) so Pediatrics and future specialties work without touching OB/GYN templates
- Adds company autocomplete to medical rep booking
- Adds a pg_trgm index on `medical_rep.company_name` for performance

---

## 1. Book Visit Shell Template — v7 → v8

### `visit_metadata` section (changes only)

| Field | Change |
|-------|--------|
| `visitor_type` | Keep |
| `specialty_code` | Keep |
| `care_path_code` | **Keep, optional** — drives complaint chips and episode assignment downstream |
| `scheduled_at_patient` | Keep |
| `scheduled_at_rep` | Keep |
| `priority_patient` | Keep as optional (NORMAL default) — used by dashboard waiting list sort |
| `priority_rep` | **Remove** — med rep visits are almost always routine |
| `assigned_doctor_patient` | Keep |
| `assigned_doctor_rep` | Keep |
| `appointment_type` | Keep |

### `patient_info` section — no changes

All fields remain: `patient_id` (LOOKUP), `full_name`, `national_id`, `date_of_birth`, `phone_number`, `address`, `marital_status`, spouse fields.

### `vitals` section — **removed entirely**

Remove all 7 fields: `systolic_bp`, `diastolic_bp`, `pulse`, `temperature_c`, `weight_kg`, `height_cm`, `bmi` (COMPUTED).

Vitals belong in the encounter, not booking.

### `medical_rep_info` section (changes only)

| Field | Change |
|-------|--------|
| `medical_rep_id` (LOOKUP, hidden) | Keep |
| `rep_full_name` (ENTITY_SEARCH) | Keep |
| `rep_national_id` | **Remove** |
| `rep_phone_number` | Keep |
| `rep_email` | **Remove** |
| `company_name` (TEXT) | Keep — add `config.ui.autocompleteEndpoint: '/v1/medical-reps/companies'` |
| `medication_ids` (MULTISELECT) | **Remove** (medications discussed) |
| `rep_notes` (TEXTAREA) | **Remove** (discussion notes) |

The `company_name` field stays a TEXT field (no LOOKUP, no DTO change). The `autocompleteEndpoint` config signals the frontend renderer to fetch suggestions as the user types, while still allowing free text entry.

---

## 2. OB/GYN Extension Template — v1 → v2

### `clinical_info` section → renamed to `notes`

| Field | Change |
|-------|--------|
| `chief_complaint_categories` (MULTISELECT) | Keep — change from static inline options to **dynamic `optionsSource`** |
| `severity` (SELECT) | **Remove** |
| `duration` (TEXT) | **Remove** |
| `onset` (TEXT) | **Remove** |
| `chief_complaint_notes` (TEXTAREA) | Keep |

The `chief_complaint_categories` field changes its options from a hardcoded list to:
```
optionsSource: /v1/chief-complaint-categories?specialty_code={specialty_code}&care_path_code={care_path_code}
```

This matches the existing `{field_code}` interpolation pattern used by `care_path_code` and `assigned_doctor` fields. When care_path is not selected, `care_path_code` is empty and the endpoint returns the general OB/GYN complaint list.

All existing predicates carry over: `forbidden when specialty_code != OBGYN`, `forbidden when visitor_type == MEDICAL_REP`.

---

## 3. Chief Complaint Categories — New Lookup

### Prisma model

```prisma
model ChiefComplaintCategory {
  id               String   @id @default(uuid())
  specialty_code   String
  care_path_code   String?  // null = applies to all care paths for this specialty
  code             String
  label            String
  order            Int      @default(0)
  is_deleted       Boolean  @default(false)
  deleted_at       DateTime?
  created_at       DateTime @default(now())
  updated_at       DateTime @updatedAt

  @@unique([specialty_code, care_path_code, code])
  @@index([specialty_code, care_path_code])
  @@map("chief_complaint_categories")
}
```

`care_path_code = null` means the category applies to all care paths within the specialty (general fallback). The endpoint returns care-path-specific categories first, then falls back to null-care_path categories if none exist for the given code.

### Endpoint

```
GET /v1/chief-complaint-categories?specialty_code=OBGYN&care_path_code=PREGNANCY_FOLLOWUP
```

Response: `{ data: [{ code: string, label: string }] }` (standard ResponseInterceptor shape)

Auth: requires valid Bearer token (no `@Public()` — accessed from authenticated booking form).

Query logic:
1. Fetch rows matching `(specialty_code, care_path_code)` ordered by `order ASC`
2. If none found, fall back to rows matching `(specialty_code, care_path_code = null)`
3. If still none, return empty array

### Module placement

New lightweight module: `src/core/clinical/chief-complaints/`
- `chief-complaints.module.ts`
- `chief-complaints.controller.ts` — one GET endpoint
- `chief-complaints.service.ts` — query logic above
- Registered in `app.module.ts`

### Seed data — OB/GYN categories

Seeded in `prisma/seeds/chief-complaint-categories.ts` (new file), called from `prisma/seed.ts`.

OB/GYN categories (care_path_code = null — general fallback):
`PELVIC_PAIN`, `ABNORMAL_BLEEDING`, `MENSTRUAL_IRREGULARITY`, `VAGINAL_DISCHARGE`, `INFERTILITY`, `CONTRACEPTION`, `OTHER`

Pregnancy follow-up (care_path_code matches pregnancy care path code):
`GESTATIONAL_AGE_CHECK`, `FETAL_MOVEMENT`, `PRE_ECLAMPSIA_SCREENING`, `VAGINAL_DISCHARGE`, `ABNORMAL_BLEEDING`, `OTHER`

Postpartum (care_path_code matches postpartum care path code):
`LACTATION_ISSUES`, `POSTPARTUM_BLEEDING`, `MOOD_SCREENING`, `PERINEAL_HEALING`, `OTHER`

Fertility (care_path_code matches fertility care path code):
`CYCLE_TRACKING`, `OVULATION_ISSUES`, `HORMONAL_IMBALANCE`, `RECURRENT_MISCARRIAGE`, `OTHER`

> **Note:** The exact `care_path_code` values must align with codes seeded in the care-paths seed (`prisma/seeds/`). Verify before running.

---

## 4. Medical Rep Companies Autocomplete

### New endpoint

```
GET /v1/medical-reps/companies?search=pfizer
```

Added to `MedicalRepController` + `MedicalRepService.findCompanies(search, organizationId)`.

Query:
```sql
SELECT DISTINCT company_name
FROM medical_rep
WHERE organization_id = $1
  AND is_deleted = false
  AND company_name ILIKE '%' || $2 || '%'
ORDER BY company_name ASC
LIMIT 20
```

Response: `{ data: { companies: string[] } }` (wrapped by ResponseInterceptor — return `{ companies }` from controller; because it has no `data` key, it auto-wraps correctly via the interceptor).

### Performance — pg_trgm migration

New migration enables pg_trgm and adds a GIN index:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX medical_rep_company_name_trgm_idx 
  ON medical_rep USING gin (company_name gin_trgm_ops);
```

Future: normalize `company_name` on insert (lower/trim) once data quality becomes a concern.

### Security — autocompleteEndpoint allowlist

The TEXT field `config.ui.autocompleteEndpoint` value is validated at seed time against a static allowlist in the builder's FIELD_TYPES TEXT config validator:

```typescript
const ALLOWED_AUTOCOMPLETE_ENDPOINTS = [
  '/v1/medical-reps/companies',
];
```

Any seed that references an endpoint not in this list throws at seed time, not at runtime. Add to the list when new autocomplete fields are introduced.

---

## 5. Builder — TEXT Field Autocomplete Config

In the FIELD_TYPES registry, the TEXT field's `ui` config shape gains:

```typescript
ui?: {
  multiline?: boolean;
  autocompleteEndpoint?: string; // validated against allowlist at seed time
}
```

This is a pass-through config — the renderer includes it in the template API response; the frontend is responsible for rendering the text input with server-side suggestions.

No runtime enforcement needed on the backend — the field value is always stored as a plain string regardless of whether autocomplete was used.

---

## Files Modified / Created

| File | Action |
|------|--------|
| `prisma/schema.prisma` | Add `ChiefComplaintCategory` model |
| New migration | Create `chief_complaint_categories` table + pg_trgm extension + GIN index on `medical_rep.company_name` |
| `prisma/seeds/book-visit-shell.ts` | Bump to v8 (remove `priority_rep`, remove vitals section, simplify `medical_rep_info`, add autocompleteEndpoint to `company_name`) |
| `prisma/seeds/obgyn-book-visit.ts` | Bump to v2 (rename section to `notes`, remove severity/duration/onset, change `chief_complaint_categories` to dynamic optionsSource) |
| `prisma/seeds/chief-complaint-categories.ts` | **New** — seed OB/GYN complaint categories per care_path |
| `prisma/seed.ts` | Register new seed module |
| `src/core/clinical/chief-complaints/chief-complaints.module.ts` | **New** |
| `src/core/clinical/chief-complaints/chief-complaints.controller.ts` | **New** — GET /v1/chief-complaint-categories |
| `src/core/clinical/chief-complaints/chief-complaints.service.ts` | **New** — query logic with fallback |
| `src/app.module.ts` | Register ChiefComplaintsModule |
| `src/core/clinical/medical-rep/medical-rep.service.ts` | Add `findCompanies()` |
| `src/core/clinical/medical-rep/medical-rep.controller.ts` | Add GET /medical-reps/companies |
| `src/builder/fields/` (FIELD_TYPES registry) | Add `autocompleteEndpoint` to TEXT ui config shape + allowlist validation |

---

## Verification

1. `npm run build` — no TypeScript errors
2. `npx prisma migrate dev --name simplify-obgyn-booking-form` — migration applies cleanly
3. `npx prisma db seed` — both templates activate at their new versions
4. `GET /v1/form-templates/book_visit` — confirm: vitals section absent, medical_rep_info has 5 fields (not 8), company_name has autocompleteEndpoint in config
5. `GET /v1/form-templates/obgyn_book_visit_ext` — confirm: section named `notes`, has 2 fields (`chief_complaint_categories` with optionsSource, `chief_complaint_notes` TEXTAREA)
6. `GET /v1/medical-reps/companies?search=pfizer` — returns `{ data: { companies: string[] } }`
7. `GET /v1/chief-complaint-categories?specialty_code=OBGYN` — returns general OB/GYN list (7 categories)
8. `GET /v1/chief-complaint-categories?specialty_code=OBGYN&care_path_code=PREGNANCY_FOLLOWUP` — returns pregnancy-specific list
9. `npm run test` — no regressions