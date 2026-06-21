# Cradlen API — k6 Load Tests

Find how many concurrent users the API serves before it degrades (the "crackdown"
knee), plus a soak profile to catch leaks under sustained load.

| Script | Purpose | Run order |
|---|---|---|
| `smoke.js` | 1 VU sanity check — auth flow + every endpoint returns 2xx | **always first** |
| `stress.js` | Ramp VUs up a ladder until error rate / latency spike → finds the knee | second |
| `soak.js` | Hold steady load (~70% of the knee) for 30–60 min → finds drift/leaks | last |

All scripts share `config.js` (target + user pool + thresholds), `lib/auth.js`
(the real 2-step login → profile-select flow), and `lib/scenarios.js` (the
read-dominant traffic mix).

## Prerequisites

1. **Install k6** (not an npm package — a standalone binary):
   - Windows: `winget install k6 --source winget` or `choco install k6`
   - macOS: `brew install k6` · Linux: see https://grafana.com/docs/k6/latest/set-up/install-k6/
   - Verify: `k6 version`
2. **Test credentials that exist on the target.**
   - Local: run `npm run seed:fixtures` in `cradlen-api` — creates the `*.test`
     doctor accounts this suite defaults to (password `TestPass123!`).
   - Production: the seed users do **not** exist there. Supply real load-test
     credentials via `-e USERS='[{"email":"...","password":"..."}]'`.
3. **(Production only) raise the rate limit.** The global throttler is
   `THROTTLE_LIMIT=100 / THROTTLE_TTL=60000` per IP (`src/config/app.config.ts`),
   and `POST /auth/login` is capped at 10 / 10 min per email+IP. From one k6 box
   you will measure the *rate limiter*, not capacity, unless you temporarily
   raise `THROTTLE_LIMIT` (and ideally the login `@Throttle`) on the deployment
   and **revert it after the run**.

## Run

```bash
# 1) Local dry run FIRST — validate the scripts before touching prod
k6 run -e BASE_URL=http://localhost:3000/v1 load-tests/smoke.js

# 2) Production smoke (maintenance window), with real creds
k6 run -e BASE_URL=https://api.cradlen.com/v1 \
       -e USERS='[{"email":"loadtest1@example.com","password":"…"}]' \
       load-tests/smoke.js

# 3) Stress — find the knee
k6 run -e BASE_URL=https://api.cradlen.com/v1 -e USERS='…' load-tests/stress.js

# 4) Soak — ~70% of the knee VU count, hold 45 min
k6 run -e BASE_URL=https://api.cradlen.com/v1 -e USERS='…' \
       -e VUS=280 -e DURATION=45m load-tests/soak.js
```

`k6 inspect load-tests/stress.js` parses a script (and its imports) without
running it — handy to syntax-check after edits.

## Environment variables

| Var | Default | Used by | Meaning |
|---|---|---|---|
| `BASE_URL` | `https://api.cradlen.com/v1` | all | Target API base (include `/v1`) |
| `USERS` | seeded `*.test` doctors | all | JSON array `[{email,password}]` of the login pool |
| `TEST_PASSWORD` | `TestPass123!` | all | Password for users without one |
| `REQUEST_TIMEOUT` | `30s` | all | Per-request timeout |
| `WRITE_ENABLED` | `false` | mix | Enable the opt-in write flow (test org only) |
| `WRITE_BODY` | — | mix | JSON `BookVisitDto` payload for the write flow |
| `STAGE_SECONDS` | `120` | stress | Seconds held at each VU plateau |
| `MAX_VUS` | `1200` | stress | Top of the default ramp ladder |
| `STAGES` | — | stress | Full custom ramp, JSON `[{target,duration}]` |
| `VUS` | `100` | soak | Concurrent VUs to hold |
| `DURATION` | `30m` | soak | Soak hold time |

## Reading the result

- **Knee / capacity ceiling** = the highest VU plateau where `http_req_failed`
  stayed `< 1%` **and** `http_req_duration p(95)` stayed under target. The next
  plateau (where one of those crosses the abort line) is past capacity.
- The end-of-test summary lists `http_req_duration` and `http_req_failed` overall
  and **per endpoint** via the `{name:...}` tags (waiting_list, journey_timeline,
  invoices_list, visit_history, me, login, select_profile). The endpoint whose
  p95 climbs first is the bottleneck.
- An **aborted run** means a threshold tripped — that's the system telling you
  it crossed the danger line. Note the VU count at abort: that is the ceiling.
- For a richer view, stream to a backend, e.g.
  `k6 run --out json=run.json load-tests/stress.js` or a Grafana/InfluxDB output.

## Safety (production runs)

- Run in a **coordinated maintenance window** with Sentry + Neon dashboards open.
- The mix is **read-dominant**; writes are OFF unless `WRITE_ENABLED=true`, and
  then only against a **throwaway test org/branch**.
- `abortOnFail` thresholds (`config.js`) stop the run automatically if errors or
  latency spike, protecting live users.
- **Revert** the raised `THROTTLE_LIMIT` afterward.
