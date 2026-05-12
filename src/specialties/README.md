# src/specialties/

First-class clinical specialty modules. One folder per specialty (obgyn, pediatric, physio, …).

Each specialty owns:
- Its 1:1 sidecar tables on `Patient`, `Visit`, `PatientJourney`, `PatientEpisode` (defined in the unified `prisma/schema.prisma`).
- Section-level PATCH endpoints with optimistic concurrency (`If-Match: "version:N"`).
- Care-path seeds (registered from the root `prisma/seed.ts`).

## Boundaries

- `specialties → core` is allowed only via `*.module.ts` and `*.public.ts` files.
- `specialties → infrastructure`, `specialties → builder`, `specialties → plugins`: forbidden.
- `plugins → specialties`: forbidden. The two are sibling layers.

`specialties/` is **not** the same as `plugins/`. Specialties are first-class clinical
domain code. `plugins/` is reserved for cross-cutting integrations (telemedicine, billing,
AI, payments, …).
