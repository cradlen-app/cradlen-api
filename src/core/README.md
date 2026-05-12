# `core/`

Domain layer. Everything that is *the product* — auth, organizations, patients, clinical workflows — lives here.

## Dependency rule

`core → common, infrastructure, builder.` Must never import from `plugins`. Enforced by `eslint.config.mjs`.

## Subfolders

- `auth/` — identity, sessions, OTP, password reset.
- `org/` — `organizations`, `branches`, `profiles`, `staff`, `invitations`, `roles`, `job-functions`, `specialties`, `subscriptions`.
- `patient/` — patient records (cross-org via `PatientJourney`).
- `clinical/` — `clinical` (encounters/vitals/prescriptions/investigations), `journeys`, `journey-templates`, `visits`, `patient-history`, `lab-tests`, `medications`.
- `notifications/` — in-app notifications + listeners that translate cross-domain events into notifications.
- `health/` — DB connectivity probe.

Per-module granularity inside each subfolder is preserved — one folder per original module under `src/modules/`.

## Public surface for plugins

Plugins may import from a `core` module only via files named `*.module.ts` or `*.public.ts`. Internal services, repositories, and DTOs are off-limits. Enforced by `eslint.config.mjs`.
