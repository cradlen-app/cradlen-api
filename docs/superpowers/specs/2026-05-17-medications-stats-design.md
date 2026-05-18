# Medications List — Prescription Stats & Medical Rep Links

**Date:** 2026-05-17  
**Author:** ibrahem abodeif  
**Status:** Approved

---

## Context

The existing `GET /medications` endpoint returns a paginated flat list of medication rows. Clinicians and admins need to know how actively each medication is being used (total prescription items written, broken down by prescriber) and which pharma reps are promoting it. This enriches the medicines catalog page without any schema changes or new tables.

---

## Scope

Enhance `GET /medications` to include per-row stats:
- `total_prescriptions` — how many prescription items reference this medication (org-scoped)
- `top_prescribers` — top 5 doctors by count (profile_id + full name + count)
- `medical_reps` — reps who promote this medication (id + full_name + company_name)

**Out of scope:** separate detail endpoint, date-range filtering, create/update/delete response shapes (stay as `MedicationDto`).

---

## Architecture

No schema migration. No new Prisma models. Changes are contained to:
- `src/core/clinical/medications/dto/medication.dto.ts` — add `MedicationWithStatsDto` class
- `src/core/clinical/medications/medications.service.ts` — enrich `findAll()` with two batch queries
- `src/core/clinical/medications/medications.controller.ts` — update Swagger decorator to `MedicationWithStatsDto`

### Data flow

```
findAll(query, user)
  │
  ├─ [existing] paginated medication query → items[]
  │
  ├─ if items is empty → return early
  │
  ├─ medicationIds = items.map(m => m.id)
  │
  ├─ Batch query A: PrescriptionItem stats (org-scoped via prescriber's organization_id)
  │    PrescriptionItem.findMany where:
  │      medication_id IN medicationIds
  │      is_deleted = false
  │      prescription.is_deleted = false
  │      prescription.prescribed_by.organization_id = user.organizationId
  │    select: { medication_id, prescription: { prescribed_by_id, prescribed_by: { user: { first_name, last_name } } } }
  │    → aggregate in TS: group by (medication_id, prescribed_by_id) → count → sort desc → top 5
  │
  ├─ Batch query B: Medical rep links
  │    MedicalRepMedication.findMany where: medication_id IN medicationIds
  │    include: { medical_rep: { select: { id, full_name, company_name } } }
  │    → group by medication_id in TS
  │
  └─ Merge A and B into each item → paginated(enrichedItems, ...)
```

### Org-scoping for prescription counts

Prescription → `prescribed_by_id (Profile)` → `organization_id`. Filtering by `prescribed_by.organization_id = user.organizationId` ensures counts are always scoped to the caller's organization. Global medications (organization_id = null) show org-scoped usage stats — a global med prescribed by this org counts toward its stats.

### Response shape

```ts
// New DTO (list only)
class MedicationPrescriberDto {
  profile_id: string;
  full_name: string;
  count: number;
}

class MedicalRepLinkDto {
  id: string;
  full_name: string;
  company_name: string;
}

class MedicationWithStatsDto extends MedicationDto {
  total_prescriptions: number;         // 0 if never prescribed
  top_prescribers: MedicationPrescriberDto[];  // max 5, sorted by count desc
  medical_reps: MedicalRepLinkDto[];   // all linked reps (via MedicalRepMedication)
}
```

### Why batch queries, not Prisma groupBy

Prisma `groupBy` does not support nested relation fields in the `by` clause (e.g. `prescription.prescribed_by.organization_id`). A raw SQL approach works but loses type safety. The batch findMany + TS aggregation pattern is readable, testable, and handles a typical page (10–25 meds) efficiently — no N+1 since both queries are keyed on `IN [ids]`.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/core/clinical/medications/dto/medication.dto.ts` | Add `MedicationPrescriberDto`, `MedicalRepLinkDto`, `MedicationWithStatsDto` |
| `src/core/clinical/medications/medications.service.ts` | Add `gatherStats()` private method, call from `findAll()` |
| `src/core/clinical/medications/medications.controller.ts` | Change `@ApiPaginatedResponse(MedicationDto)` → `MedicationWithStatsDto` on `findAll` |

---

## Key Invariants

- Stats fields default to `[]` / `0` for medications with no prescriptions or no rep links — never null/undefined.
- `top_prescribers` is capped at 5, sorted by count descending.
- Prescription count only counts non-deleted `PrescriptionItem` rows on non-deleted `Prescription` rows, for prescribers in the caller's org.
- `create` and `update` response shape stays as `MedicationDto` (no stats needed).

---

## Verification

1. `npm run start:dev` — server starts without errors
2. `GET /v1/medications` with a valid bearer token → response includes `total_prescriptions`, `top_prescribers`, `medical_reps` on each item
3. For a medication known to have prescriptions → `total_prescriptions > 0` and `top_prescribers` is non-empty
4. For a medication linked to a rep via `MedicalRepMedication` → `medical_reps` includes that rep's `full_name` and `company_name`
5. For a medication with no prescriptions → `total_prescriptions: 0`, `top_prescribers: []`
6. `npm run lint` passes