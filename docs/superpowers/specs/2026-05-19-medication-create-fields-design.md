# Medication Create Fields Enhancement

**Date:** 2026-05-19  
**Status:** Approved

## Context

The existing `POST /medications` endpoint only captures `code`, `name`, `generic_name`, `form`, and `strength`. Clinicians and staff need richer metadata at creation time — `category` (therapeutic area), `company` (pharma manufacturer), `notes`, and a structured `default_dose` (amount, unit, frequency, route). `form` and `strength` were already strings; they stay strings but the frontend will now present them as select-from-existing-or-type-new lists using distinct values fetched client-side.

## Data Model

Single Prisma migration adding nullable columns to `Medication`:

| Column | Type | Notes |
|---|---|---|
| `category` | `String?` | Therapeutic category, free-text stored |
| `company` | `String?` | Pharmaceutical company name |
| `notes` | `String?` | Free-text clinical notes |
| `default_dose_amount` | `Decimal?` | Numeric dose quantity |
| `default_dose_unit` | `String?` | e.g. mg, ml, mcg |
| `default_dose_frequency` | `String?` | e.g. twice daily |
| `default_dose_route` | `String?` | e.g. oral, IV, topical |

`form` and `strength` remain as existing `String?` columns — no schema change needed for them.

## API Changes

### `POST /medications` — extend CreateMedicationDto

New optional fields added alongside existing `code`, `name`, `generic_name`, `form`, `strength`:

```ts
category?: string
company?: string
notes?: string
default_dose_amount?: number
default_dose_unit?: string
default_dose_frequency?: string
default_dose_route?: string
```

### `PATCH /medications/:id` — extend UpdateMedicationDto

Same new optional fields added so existing medications can be updated.

### Response DTOs (`MedicationDto`, `MedicationWithStatsDto`)

Expose all new fields in API responses.

## No New Endpoints

The frontend will derive `category`, `form`, and `strength` select lists from distinct values in existing medication records — no `GET /medications/options` endpoint needed.

## Files to Change

- `prisma/schema.prisma` — add 7 columns to `Medication` model
- `prisma/migrations/` — generated via `npx prisma migrate dev`
- `src/core/clinical/medications/dto/create-medication.dto.ts`
- `src/core/clinical/medications/dto/update-medication.dto.ts`
- `src/core/clinical/medications/dto/medication.dto.ts`
- `src/core/clinical/medications/medications.service.ts` — pass new fields in `create` and `update`

## Verification

1. Run `npx prisma migrate dev --name add-medication-fields` — migration applies cleanly
2. `POST /medications` with all new fields → 201, response includes all new fields
3. `POST /medications` with only `code` + `name` (existing minimum) → still 201, new fields null
4. `PATCH /medications/:id` updating `category`, `company`, `notes`, dose fields → 200, response reflects changes
5. `GET /medications` → response includes new fields on each item