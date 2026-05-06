# Visits Foundation — Design Spec

**Date:** 2026-05-06
**Branch:** feature/settings
**Status:** Approved

---

## Context

Cradlen is moving from a visit-based model to a journey-based Modular Medical Record (MMR). The foundation layer introduced here establishes the core entities that everything else builds on: a global Patient record, templated Journeys with auto-created Episodes, and Visits as the leaf-level appointment unit.

This spec covers **foundation only** — no lab results, medications, radiology, or family linkages yet.

---

## Hierarchy

```
Specialty (seed — e.g. GYN)
  └── JourneyTemplate (seed — e.g. Pregnancy Journey)
        └── EpisodeTemplate (seed — e.g. First Trimester)

Patient (global, platform-wide)
  └── PatientJourney (org-scoped, linked to JourneyTemplate)
        └── PatientEpisode (auto-created from EpisodeTemplate)
              └── Visit (individual appointment)
```

---

## Data Model

### Global entities (not org-scoped)

#### `Patient`
| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `national_id` | String (unique) | Primary global identifier — searchable across all orgs |
| `full_name` | String | |
| `husband_name` | String? | Nullable — only if married |
| `date_of_birth` | DateTime | |
| `phone_number` | String | |
| `address` | String | |
| `created_at`, `updated_at` | DateTime | |
| `is_deleted`, `deleted_at` | soft-delete | |

#### `Specialty` *(seed-only)*
| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | String (unique) | e.g. "Gynecology" |
| `code` | String (unique) | e.g. `GYN` — short identifier |
| `description` | String? | |

#### `JourneyTemplate` *(seed-only)*
| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `specialty_id` | FK → Specialty | Which specialty this template belongs to |
| `name` | String (unique) | e.g. "Pregnancy Journey" |
| `type` | Enum | `PREGNANCY`, `GENERAL_GYN`, `SURGICAL`, `CHRONIC_CONDITION` |
| `description` | String? | |

#### `EpisodeTemplate` *(seed-only)*
| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `journey_template_id` | FK → JourneyTemplate | |
| `name` | String | e.g. "First Trimester" |
| `order` | Int | Display order within the journey |

---

### Org-scoped entities

#### `PatientJourney`
| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `patient_id` | FK → Patient | |
| `organization_id` | FK → Organization | |
| `journey_template_id` | FK → JourneyTemplate | |
| `status` | Enum | `ACTIVE`, `COMPLETED`, `CANCELLED` |
| `started_at` | DateTime | |
| `ended_at` | DateTime? | |
| `created_by_id` | FK → Profile | Doctor who opened the journey |
| `created_at`, `updated_at` | DateTime | |
| `is_deleted`, `deleted_at` | soft-delete | |

**Unique constraint:** `(patient_id, organization_id, journey_template_id)` where `status = ACTIVE` — one active journey per template per patient per org.

#### `PatientEpisode`
| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `journey_id` | FK → PatientJourney | |
| `episode_template_id` | FK → EpisodeTemplate | |
| `name` | String | Copied from template at creation time |
| `order` | Int | Copied from template |
| `status` | Enum | `PENDING`, `ACTIVE`, `COMPLETED` |
| `started_at` | DateTime? | |
| `ended_at` | DateTime? | |
| `created_at`, `updated_at` | DateTime | |
| `is_deleted`, `deleted_at` | soft-delete | |

When a journey is created, **all episodes are auto-created in a single transaction**: first episode → `ACTIVE`, all others → `PENDING`.

#### `Visit`
| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `episode_id` | FK → PatientEpisode | |
| `assigned_doctor_id` | FK → Profile | |
| `branch_id` | FK → Branch | Branch where the visit takes place |
| `visit_type` | Enum | `INITIAL`, `FOLLOW_UP`, `ROUTINE`, `EMERGENCY`, `PROCEDURE` |
| `priority` | Enum | `LOW`, `NORMAL`, `HIGH`, `URGENT` |
| `status` | Enum | `SCHEDULED`, `CHECKED_IN`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW` |
| `scheduled_at` | DateTime | |
| `checked_in_at` | DateTime? | Set when status → CHECKED_IN |
| `started_at` | DateTime? | Set when status → IN_PROGRESS |
| `completed_at` | DateTime? | Set when status → COMPLETED |
| `notes` | String? | |
| `created_by_id` | FK → Profile | Receptionist who booked the visit |
| `created_at`, `updated_at` | DateTime | |
| `is_deleted`, `deleted_at` | soft-delete | |

**Valid status transitions:**
- `SCHEDULED` → `CHECKED_IN` | `CANCELLED` | `NO_SHOW`
- `CHECKED_IN` → `IN_PROGRESS` | `CANCELLED` | `NO_SHOW`
- `IN_PROGRESS` → `COMPLETED` | `CANCELLED`
- Terminal states: `COMPLETED`, `CANCELLED`, `NO_SHOW`

---

## New Enums (Prisma)

```prisma
enum JourneyTemplateType {
  PREGNANCY
  GENERAL_GYN
  SURGICAL
  CHRONIC_CONDITION
}

enum JourneyStatus {
  ACTIVE
  COMPLETED
  CANCELLED
}

enum EpisodeStatus {
  PENDING
  ACTIVE
  COMPLETED
}

enum VisitType {
  INITIAL
  FOLLOW_UP
  ROUTINE
  EMERGENCY
  PROCEDURE
}

enum VisitPriority {
  LOW
  NORMAL
  HIGH
  URGENT
}

enum VisitStatus {
  SCHEDULED
  CHECKED_IN
  IN_PROGRESS
  COMPLETED
  CANCELLED
  NO_SHOW
}
```

---

## API Endpoints

### `patients` module — `/v1/patients`

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/patients` | Register new patient | Any profile |
| `GET` | `/patients` | List/search patients (name, national_id, phone) | Any profile |
| `GET` | `/patients/lookup?nationalId=xxx` | Quick lookup by national ID for auto-fill | Any profile |
| `GET` | `/patients/:id` | Get patient base profile | Any profile |
| `PATCH` | `/patients/:id` | Update patient base info | Any profile |

`lookup` returns the patient object. For DOCTOR/OWNER roles it also includes the full active journey with episodes. For other roles it includes only the active episodes list (id + name) so the receptionist can select which episode to book a visit into — no clinical details (notes, dates, status) are included.

### `specialties` module — `/v1/specialties`

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/specialties` | List all specialties | Any profile |
| `GET` | `/specialties/:id/journey-templates` | List templates for a specialty with episodes | Any profile |

Read-only. Populated via Prisma seed.

### `journey-templates` module — `/v1/journey-templates`

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/journey-templates` | List all templates (optionally `?specialtyId=xxx`) | Any profile |
| `GET` | `/journey-templates/:id` | Get one template with episodes | Any profile |

Read-only. Populated via Prisma seed.

### `journeys` module — `/v1/`

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/patients/:patientId/journeys` | Open a new journey (auto-creates episodes) | DOCTOR, OWNER |
| `GET` | `/patients/:patientId/journeys` | List patient's journeys at this org | DOCTOR, OWNER |
| `GET` | `/journeys/:id` | Get journey with episodes | DOCTOR, OWNER |
| `PATCH` | `/journeys/:id/status` | Complete or cancel a journey | DOCTOR, OWNER |
| `PATCH` | `/journeys/:id/episodes/:episodeId/status` | Advance episode status | DOCTOR, OWNER |

### `visits` module — `/v1/`

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/episodes/:episodeId/visits` | Create a visit | Any profile |
| `GET` | `/episodes/:episodeId/visits` | List visits in an episode | Any profile |
| `GET` | `/visits/:id` | Get visit details | Any profile |
| `PATCH` | `/visits/:id` | Update visit metadata | Any profile |
| `PATCH` | `/visits/:id/status` | Advance visit status | Any profile |

---

## Module Structure

```
src/modules/
├── patients/
│   ├── patients.module.ts
│   ├── patients.controller.ts
│   ├── patients.service.ts
│   └── dto/
│       ├── create-patient.dto.ts
│       ├── update-patient.dto.ts
│       └── patient.dto.ts
├── specialties/
│   ├── specialties.module.ts
│   ├── specialties.controller.ts
│   ├── specialties.service.ts
│   └── dto/
│       └── specialty.dto.ts
├── journey-templates/
│   ├── journey-templates.module.ts
│   ├── journey-templates.controller.ts
│   ├── journey-templates.service.ts
│   └── dto/
│       └── journey-template.dto.ts
├── journeys/
│   ├── journeys.module.ts
│   ├── journeys.controller.ts
│   ├── journeys.service.ts
│   └── dto/
│       ├── create-journey.dto.ts
│       ├── update-journey-status.dto.ts
│       └── journey.dto.ts
└── visits/
    ├── visits.module.ts
    ├── visits.controller.ts
    ├── visits.service.ts
    └── dto/
        ├── create-visit.dto.ts
        ├── update-visit.dto.ts
        ├── update-visit-status.dto.ts
        └── visit.dto.ts
```

Episodes live inside the `journeys` module — no independent lifecycle, no dedicated module.

---

## Receptionist Flow

1. Type national ID → `GET /patients/lookup?nationalId=xxx`
   - Found: form auto-fills; receptionist sees `has_active_journey: true` if applicable
   - Not found: empty form
2. If new patient: `POST /patients`
3. Select episode from patient's active journey (provided by lookup response as episode list — shown to receptionist as episode names only, no clinical detail)
4. `POST /episodes/:episodeId/visits` with doctor, visit type, priority, scheduled time, branch, notes

## Doctor Flow

1. `GET /journey-templates` → pick template
2. `POST /patients/:patientId/journeys` → system auto-creates all episodes in one transaction
3. `PATCH /journeys/:id/episodes/:episodeId/status` to advance through episodes as patient progresses

---

## Business Rules

- `national_id` is globally unique — duplicate `POST /patients` returns `409`
- A patient can have at most **one active journey per template type per org** at a time — enforced in application code (service layer checks before insert; Prisma partial unique indexes are not used)
- Creating a journey auto-creates all its episodes atomically; first episode is `ACTIVE`, rest are `PENDING`
- Episode status can only advance forward: `PENDING` → `ACTIVE` → `COMPLETED`
- Visit status transitions are server-enforced (invalid transitions return `400`)
- Timestamp fields (`checked_in_at`, `started_at`, `completed_at`) are set automatically by the server on status change — not accepted from the client
- `branch_id` on Visit defaults to the requesting profile's active branch if not provided

---

## Seed Data

```
Specialty: GYN (Gynecology)
  JourneyTemplate: PREGNANCY
    EpisodeTemplates (order 1-5):
      1. First Trimester
      2. Second Trimester
      3. Third Trimester
      4. Delivery
      5. Postpartum

  JourneyTemplate: GENERAL_GYN
    EpisodeTemplates (order 1):
      1. General Consultation

  JourneyTemplate: SURGICAL
    EpisodeTemplates (order 1-3):
      1. Pre-operative
      2. Surgery
      3. Post-operative

  JourneyTemplate: CHRONIC_CONDITION
    EpisodeTemplates (order 1-2):
      1. Diagnosis & Stabilization
      2. Ongoing Management
```

Adding a new specialty in the future = new `Specialty` seed row + new `JourneyTemplate` + `EpisodeTemplate` rows. No code changes required.

---

## Verification

1. Run `npx prisma migrate dev --name visits-foundation` — migration should apply cleanly
2. Run `npx prisma db seed` — journey templates and episode templates should be seeded
3. `POST /patients` with a new national ID → `201` with patient object
4. `GET /patients/lookup?nationalId=xxx` → `200` with auto-fill data
5. `GET /patients/lookup?nationalId=nonexistent` → `404`
6. `POST /patients` with duplicate national ID → `409`
7. `POST /patients/:patientId/journeys` (as DOCTOR) → `201`; verify all episodes created in DB
8. `POST /patients/:patientId/journeys` again with same template → `409` (active journey exists)
9. `POST /episodes/:episodeId/visits` → `201`
10. `PATCH /visits/:id/status` with invalid transition → `400`
11. `PATCH /visits/:id/status` with valid transition → `200`; verify timestamp auto-set
12. `GET /journeys/:id` as receptionist role → `403`
