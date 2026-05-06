# Design: Visit Lookup Endpoints

**Date:** 2026-05-06  
**Branch:** feature/visits  
**Author:** ibrahem abodeif

---

## Context

The visit booking flow requires two supporting lookups that are not yet available:

1. **Doctor selection** — when booking a visit, the caller needs to pick an available doctor from the branch. No filtered-by-role staff query exists yet.
2. **Branch visit lists** — receptionists, doctors, and owners need to see scheduled visits (waiting list) and in-progress visits per branch. Currently visits are only queryable per-episode.

---

## Feature 1: Filter Staff by Role

### Endpoint

Extend the existing staff listing endpoint with an optional `role` query param:

```
GET /v1/staff?branchId=<uuid>&role=DOCTOR
```

### Changes

**File:** `src/modules/staff/dto/list-staff.dto.ts` (or equivalent query DTO)  
- Add optional `role?: string` field validated as a string.

**File:** `src/modules/staff/staff.service.ts` — `listStaff()`  
- When `role` is provided, add to the Prisma `where`:
  ```ts
  roles: { some: { role: { name: role.toUpperCase() } } }
  ```

### Authorization

No change — existing staff listing auth applies (any authenticated profile in the organization).

### Response

Same shape as existing `listStaff` response. No new DTO needed.

---

## Feature 2: Branch-Level Visits by Status

### Endpoint

New endpoint in the visits controller:

```
GET /v1/branches/:branchId/visits?status=SCHEDULED&page=1&limit=20
```

### Query Params

| Param    | Type        | Required | Notes                              |
|----------|-------------|----------|------------------------------------|
| `status` | `VisitStatus` enum | Yes  | e.g. `SCHEDULED`, `IN_PROGRESS`   |
| `page`   | number      | No       | Default 1                          |
| `limit`  | number      | No       | Default 20                         |

### Authorization

Caller must be a member of the branch or an OWNER in the organization.  
Use `AuthorizationService.canAccessBranch(profileId, branchId)` — throws `ForbiddenException` if false.

Allowed roles: OWNER, DOCTOR, RECEPTION.

### Prisma Query

```ts
db.visit.findMany({
  where: {
    branch_id: branchId,
    status,
    is_deleted: false,
  },
  include: {
    assigned_doctor: {
      include: { user: { select: { id: true, first_name: true, last_name: true } } },
    },
    episode: {
      include: { patient: { select: { id: true, name: true } } },
    },
  },
  skip: (page - 1) * limit,
  take: limit,
  orderBy: { scheduled_at: 'asc' },
})
```

Count query runs in parallel for pagination meta.

### Response

Paginated via `paginated()` helper:

```json
{
  "data": [
    {
      "id": "uuid",
      "visit_type": "VISIT",
      "priority": "NORMAL",
      "status": "SCHEDULED",
      "scheduled_at": "2026-05-06T10:00:00Z",
      "notes": null,
      "assigned_doctor": {
        "id": "uuid",
        "specialty": "Gynecology",
        "user": { "id": "uuid", "first_name": "Ahmed", "last_name": "Ali" }
      },
      "episode": {
        "id": "uuid",
        "patient": { "id": "uuid", "name": "Fatima Hassan" }
      }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 5, "totalPages": 1 }
}
```

### New Files

- `src/modules/visits/dto/list-branch-visits.dto.ts` — query DTO with `status`, `page`, `limit`
- `src/modules/visits/dto/branch-visit.dto.ts` — response DTO

### Modified Files

- `src/modules/visits/visits.controller.ts` — add `GET /branches/:branchId/visits` route
- `src/modules/visits/visits.service.ts` — add `findAllForBranch(branchId, dto, user)` method

---

## Verification

1. Start dev server: `npm run start:dev`
2. Authenticate and get a valid access token.
3. **Doctor filter:** `GET /v1/staff?branchId=<uuid>&role=DOCTOR` — should return only doctor profiles.
4. **Waiting list:** `GET /v1/branches/<branchId>/visits?status=SCHEDULED` — should return paginated SCHEDULED visits.
5. **In progress:** `GET /v1/branches/<branchId>/visits?status=IN_PROGRESS` — should return IN_PROGRESS visits.
6. Test unauthorized access (profile not in branch) → expect 403.
7. Test invalid status value → expect 400 validation error.
