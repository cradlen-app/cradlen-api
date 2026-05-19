# Patient Org Enrollment Design

**Date:** 2026-05-18
**Status:** Approved for implementation

---

## Context

When a visit is booked for a new patient, three things happen in one atomic transaction:

1. A global `Patient` record is created
2. A `PatientJourney` with `status=ACTIVE` is created — tying the patient to the org
3. A `Visit` with `status=SCHEDULED` is created

There is no staging layer. The patient immediately appears in the org's roster as an active patient, even if they have never checked in or been seen. If the patient cancels, doesn't show up, or the visit simply expires, the only defense is a cascade cleanup — which is incomplete (no-shows never auto-expire, and the global `Patient` record is never cleaned up when no journeys remain).

**The fix:** introduce an explicit `PatientOrgEnrollment` record that separates "patient booked at this org" from "patient has actually been seen here." This is specialty-agnostic and applies to every specialty (OB/GYN, Pediatrics, etc.) without changes.

---

## New Model: `PatientOrgEnrollment`

```prisma
model PatientOrgEnrollment {
  id              String                     @id @default(uuid())
  patient_id      String
  organization_id String
  status          PatientOrgEnrollmentStatus @default(PENDING)
  created_at      DateTime                   @default(now())
  activated_at    DateTime?
  is_deleted      Boolean                    @default(false)
  deleted_at      DateTime?

  patient         Patient                    @relation(fields: [patient_id], references: [id])
  organization    Organization               @relation(fields: [organization_id], references: [id])
}

enum PatientOrgEnrollmentStatus {
  PENDING
  ACTIVE
  DISCHARGED
}
```

**One row per (patient, org).** Not per visit, not per journey.

The migration must add a **partial unique index** via raw SQL (Prisma `@@unique` does not support `WHERE` clauses — same pattern as `FormTemplate.is_active`):

```sql
CREATE UNIQUE INDEX "patient_org_enrollment_patient_org_unique"
ON "patient_org_enrollments"("patient_id", "organization_id")
WHERE is_deleted = false;
```

This allows multiple soft-deleted rows for the same (patient, org) pair over time while enforcing at most one live enrollment.

| Status | Meaning |
| --- | --- |
| `PENDING` | Patient has booked at this org but has never checked in |
| `ACTIVE` | Patient has checked in at least once — real patient of the org |
| `DISCHARGED` | Patient had care here and was explicitly discharged (future) |

---

## State Machine

```text
[first visit booked — new patient at this org]
              ↓
          PENDING
              ↓  ← first visit transitions to CHECKED_IN
           ACTIVE  ←── stays ACTIVE for all subsequent visits forever
              ↓  ← explicit staff action (future)
         DISCHARGED
```

**Cleanup path (PENDING only):**
If a `PENDING` enrollment's associated visits are all cancelled or no-show with no check-in ever, the enrollment row is **soft-deleted** (consistent with journey cleanup). No history to preserve for a patient that never came in.

---

## Booking Flow (`visits.service.ts → bookVisit`)

At the **end of the existing booking transaction**, after `Patient`, `PatientJourney`, and `Visit` are created:

1. Resolve `organization_id` from `branch.organization_id`
2. Check for an existing `PatientOrgEnrollment` where `patient_id = patient.id AND organization_id = organization_id AND is_deleted = false`
3. **If none exists** (new patient at this org) → create with `status = PENDING`
4. **If already exists** (returning patient, already `ACTIVE`) → no change

Returning patients already have `status=ACTIVE` from a prior visit — no action needed on re-booking.

---

## Check-in Trigger (`visits.service.ts → updateStatus`)

When a visit transitions to `CHECKED_IN`:

1. Resolve `organization_id` via `visit.episode.journey.organization_id`
2. Find the `PatientOrgEnrollment` for `(patient_id, organization_id)` where `is_deleted = false`
3. If `status = PENDING` → update to `ACTIVE`, stamp `activated_at = now()`
4. If `status = ACTIVE` → no-op

---

## Cancellation Cascade (extends existing logic)

The existing cascade in `updateStatus` already soft-deletes a journey when all its visits are cancelled/no-show with no check-ins. This is extended with one additional step after the journey is soft-deleted:

1. Find the `PatientOrgEnrollment` for `(patient.id, organization_id)` where `is_deleted = false`
2. If `status = PENDING` → soft-delete the enrollment row (`is_deleted = true`, `deleted_at = now()`)
3. Check if the global `Patient` has **any** remaining non-deleted journeys across all orgs
4. If no journeys remain anywhere → soft-delete the `Patient` record (`is_deleted = true`, `deleted_at = now()`)

This prevents ghost patient records from accumulating in the global table.

---

## Auto-Expiry Scheduled Job (`PatientEnrollmentCleanupService`)

A new NestJS scheduled service runs **nightly** (e.g., `0 2 * * *` — 2 AM):

```text
1. Query visits WHERE status = 'SCHEDULED'
                  AND scheduled_at < NOW()
                  AND checked_in_at IS NULL
                  AND is_deleted = false

2. For each visit: call updateStatus(visitId, NO_SHOW)
   → triggers the existing cascade
   → which triggers the enrollment cleanup above
```

Reuses the existing cascade rather than duplicating cleanup logic. The scheduled job is only responsible for marking overdue visits `NO_SHOW`.

---

## Patient Listing Query Change

`GET /v1/organizations/:orgId/patients`

- **Current:** joins through `PatientJourney.organization_id`
- **New:** joins through `PatientOrgEnrollment` where `organization_id = :orgId AND status IN ('ACTIVE', 'DISCHARGED') AND is_deleted = false`

`PENDING` patients **never appear** in the org's patient roster.

---

## Specialty Compatibility

This design is **specialty-agnostic**. The enrollment record tracks patient-org membership, not specialty-specific data.

| Specialty | Child as Patient | Parent as Guardian | Enrollment Works? |
| --- | --- | --- | --- |
| OB/GYN | N/A | Spouse via existing logic | Yes |
| Pediatrics | Child is the `Patient` | Parent via `GuardianRelation.PARENT` (existing enum) | Yes |
| Future specialties | Any patient | Any guardian relation | Yes |

The `GuardianRelation` enum already includes `PARENT` and `CHILD`. Guardian booking generalization (extending beyond spouse) is out of scope for this spec and belongs in the Pediatrics specialty spec.

---

## Files to Modify

| File | Change |
| --- | --- |
| `prisma/schema.prisma` | Add `PatientOrgEnrollment` model and `PatientOrgEnrollmentStatus` enum; add back-relations on `Patient` and `Organization` |
| `prisma/migrations/` | New migration for the table + raw SQL partial unique index |
| `src/core/clinical/visits/visits.service.ts` | `bookVisit`: create enrollment after transaction; `updateStatus`: activate on CHECKED_IN, soft-delete on cascade cleanup |
| `src/core/patient/patients/patients.service.ts` | Filter patient listing through `PatientOrgEnrollment` |
| `src/core/patient/` (new file) | `PatientEnrollmentCleanupService` — scheduled job |
| `src/core/patient/patients.module.ts` | Register `PatientEnrollmentCleanupService`; add `@nestjs/schedule` if not already imported |
| `app.module.ts` | Add `ScheduleModule.forRoot()` if not present |

---

## Out of Scope

- Pediatric specialty module (separate spec)
- `Patient.national_id` nullable migration (separate spec, needed for pediatrics)
- Generalized guardian creation at booking beyond spouse (separate spec)
- `DISCHARGED` status transitions and staff UI (future)
- Analytics or reporting on enrollment funnel (future)

---

## Verification

1. **Book a visit for a brand-new patient** → `PatientOrgEnrollment` row exists with `status=PENDING`; patient does NOT appear in `GET /organizations/:orgId/patients`
2. **Check in that patient** → enrollment flips to `ACTIVE`, `activated_at` stamped; patient NOW appears in patient listing
3. **Book and cancel before check-in** → cancellation cascade soft-deletes enrollment; if patient has no other journeys, patient record is also soft-deleted
4. **Book, let it expire past `scheduled_at` without action** → nightly job marks `NO_SHOW`, cascade fires, enrollment cleaned up
5. **Returning patient re-books** → no new enrollment row created; existing `ACTIVE` enrollment unchanged
6. **Unit tests:** `PatientEnrollmentCleanupService`, `bookVisit` enrollment creation, `updateStatus` CHECKED_IN activation, cascade soft-delete
