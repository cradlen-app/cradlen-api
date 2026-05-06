# Branch Patients List Endpoint — Design Spec

**Date:** 2026-05-06

## Context

The existing `GET /patients` endpoint returns all patients across an organization with no branch scoping. Clinic staff (receptionists, doctors, owners) need to see only patients who have been seen at their specific branch, with search and journey filtering so they can quickly find and act on a patient's record.

## Endpoint

```
GET /v1/branches/:branchId/patients
```

## Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `page` | integer | no | 1 | Pagination page |
| `limit` | integer (1–100) | no | 20 | Items per page |
| `search` | string | no | — | Partial match on `full_name` or `national_id` (case-insensitive) |
| `journey_status` | `ACTIVE \| COMPLETED \| CANCELLED` | no | — | Filter by journey status |
| `journey_type` | `PREGNANCY \| GENERAL_GYN \| SURGICAL \| CHRONIC_CONDITION` | no | — | Filter by journey template type |

## Authorization

- Allowed roles: **OWNER, DOCTOR, RECEPTIONIST** (all staff in the branch)
- Uses `AuthorizationService.assertCanAccessBranch(profileId, branchId)` — throws `ForbiddenException` if user does not belong to the branch

## Response Shape

Paginated via `paginated()` helper — interceptor wraps to `{ data: [], meta: { page, limit, total, totalPages } }`.

Each item:
```json
{
  "id": "uuid",
  "national_id": "123456",
  "full_name": "Jane Doe",
  "phone_number": "+1234567890",
  "date_of_birth": "1990-01-15",
  "address": "123 Main St",
  "journey": {
    "id": "uuid",
    "type": "PREGNANCY",
    "status": "ACTIVE"
  }
}
```

`journey` reflects the matched journey (ACTIVE by default; matches `journey_status` filter when applied). `null` if no matching journey exists.

## Query Logic

**Branch scoping** — a patient "belongs to a branch" if they have at least one `Visit` in that branch, traversed as:

```
Patient → PatientJourney.episodes → PatientEpisode.visits → Visit.branch_id
```

Prisma filter:
```ts
journeys: {
  some: {
    organization_id: organizationId,
    is_deleted: false,
    episodes: {
      some: {
        is_deleted: false,
        visits: { some: { branch_id: branchId, is_deleted: false } }
      }
    }
  }
}
```

**Search** — `OR: [{ full_name: { contains, insensitive } }, { national_id: { contains } }]`

**Journey filters** — applied both to filter WHICH patients are returned (via `journeys.some`) and to select WHICH journey is included in the response:
- `journey_status` → `journeys.some.status = journey_status`
- `journey_type` → `journeys.some.journey_template.type = journey_type`

The included journey in each row is the first matching one (ordered by `started_at desc`).

## Files to Modify

| Action | File |
|---|---|
| Modify controller — change `@Controller('patients')` → `@Controller()`, prefix existing routes, add new route | `src/modules/patients/patients.controller.ts` |
| Add `findAllForBranch()` method | `src/modules/patients/patients.service.ts` |
| Create query DTO | `src/modules/patients/dto/list-branch-patients-query.dto.ts` |
| Add `ActiveJourneyDto` + `BranchPatientDto` | `src/modules/patients/dto/patient.dto.ts` |

## Verification

1. `npm run start:dev` — server starts with no errors
2. Swagger at `/api` shows `GET /branches/{branchId}/patients` under Patients tag
3. Hit the endpoint as a RECEPTIONIST in the branch — returns paginated patients with `active_journey`
4. Hit as a user NOT in the branch — returns `403 Forbidden`
5. `?search=john` — returns only patients whose name/national ID contains "john"
6. `?journey_status=COMPLETED` — returns only patients with a completed journey
7. `?journey_type=PREGNANCY` — returns only patients with a pregnancy journey
8. `npm run test` — existing unit tests pass
