# `@Public()` Audit — 2026-05-28

Closes finding **S-13** from `auth-review-2026-05-28.md`. Goal: confirm every opt-out from the global JWT auth guard is intentional.

## Method

```bash
rg -n '@Public\(\)' src/
```

21 matches across 7 files. Each was inspected for: (a) whether the
caller can legitimately have a valid access token at this point in the
flow, and (b) whether the response exposes any tenant data.

## Findings

| File | Endpoint | Public because | Verdict |
|---|---|---|---|
| `src/core/auth/auth.controller.ts:62` | `POST /auth/signup/start` | Pre-account, no token possible | ✅ intentional |
| `src/core/auth/auth.controller.ts:72` | `POST /auth/signup/verify` | Bearer is the signup_token, not access | ✅ |
| `src/core/auth/auth.controller.ts:82` | `POST /auth/signup/complete` | Bearer is the signup_token | ✅ |
| `src/core/auth/auth.controller.ts:94` | `POST /auth/signup/resend` | Pre-verification, no token | ✅ |
| `src/core/auth/auth.controller.ts:104` | `GET /auth/registration/status` | Pre-account or partial onboarding | ✅ |
| `src/core/auth/auth.controller.ts:119` | `POST /auth/login` | Returns selection_token before tokens exist | ✅ |
| `src/core/auth/auth.controller.ts:130` | `POST /auth/profiles/select` | Bearer is the selection_token | ✅ |
| `src/core/auth/auth.controller.ts:151` | `POST /auth/refresh` | Body carries refresh_token; access is gone | ✅ |
| `src/core/auth/auth.controller.ts:160` | `POST /auth/logout` | Token may be expired by the time logout is hit | ✅ |
| `src/core/auth/auth.controller.ts:169` | `POST /auth/forgot-password` | User can't be logged in to reset their password | ✅ |
| `src/core/auth/auth.controller.ts:181` | `POST /auth/forgot-password/resend` | Bearer is the reset_token, not access | ✅ |
| `src/core/auth/auth.controller.ts:196` | `POST /auth/verify-reset-code` | Bearer is the reset_token | ✅ |
| `src/core/auth/auth.controller.ts:210` | `POST /auth/reset-password` | Bearer is the reset_token | ✅ |
| `src/core/health/health.controller.ts:8` | All health endpoints | Probes from load balancer / orchestrator | ✅ |
| `src/core/org/specialties/specialties.controller.ts:17` | `GET /specialties/lookup` | Seeded reference data used by signup dropdowns | ✅ |
| `src/core/org/profiles/profiles.controller.ts:26` | `GET /profiles/lookups` | Enum lookups (executive_title, engagement_type) — no tenant data | ✅ |
| `src/core/org/job-functions/job-functions.controller.ts:13` | `GET /job-functions/lookup` | Seeded reference data | ✅ |
| `src/core/org/invitations/invitations.controller.ts:88` | `GET /invitations/preview` | Pre-acceptance, no profile yet — invitation token is the auth | ✅ |
| `src/core/org/invitations/invitations.controller.ts:96` | `POST /invitations/accept` | Invitation token is the auth, may create the first profile | ✅ |
| `src/core/org/invitations/invitations.controller.ts:104` | `POST /invitations/decline` | Invitation token is the auth | ✅ |

## Conclusion

**No leak.** Every opt-out belongs to one of:

1. **Pre-authentication flows** — signup, login, password reset, refresh, logout (13 routes).
2. **Token-bearing flows where the token is something other than an access token** — signup_token, selection_token, reset_token, invitation token (5 routes).
3. **Infrastructure / probes** — health checks (1 route).
4. **Public reference data** — seeded lookup tables exposed for signup dropdowns (3 routes). None of these expose tenant data.

Nothing on this list is a candidate for re-gating today.

## Defensive recommendation for future routes

When adding a new `@Public()`:

- **Reject** if the response includes any data scoped to an organization, branch, profile, or patient. Such data must require an access token.
- **Allow** when the caller is by definition unauthenticated (pre-signup, password reset, health probe) **or** when the auth is a non-access JWT carried in the body or `Authorization` header. Document the chosen auth in the `@ApiOperation` summary so the audit stays cheap to re-run.
