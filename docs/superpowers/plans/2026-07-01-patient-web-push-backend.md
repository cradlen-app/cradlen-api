# Patient Web Push — Backend (cradlen-api) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a patient Web Push slice to cradlen-api — a `PatientPushSubscription` model, subscribe/unsubscribe endpoints, and a fire-and-forget dispatch that pushes each new patient notification to every account (patient + guardians) that can access the patient.

**Architecture:** Mirror the existing staff `PushService` / admin `AdminPushService` slices almost verbatim, changing only the ownership key (login `PatientAccount` instead of `Profile`) and adding an account fan-out in dispatch. Reuse the shared `pushConfig` VAPID setup and the `web-push` library. Hook dispatch into the existing `PatientNotificationsListener` after each notification is created.

**Tech Stack:** NestJS (ESM, `.js` import suffixes), Prisma, `web-push` v3, class-validator DTOs, Jest.

## Global Constraints

- ESM imports use explicit `.js` suffixes (e.g. `./patient-push.service.js`). Copy this from surrounding files.
- Push delivery is **best-effort**: `sendToPatient` returns `void`, never throws into the caller, and prunes only 404/410 subscriptions.
- Push stays **inert when VAPID is unconfigured** (`pushConfig.enabled === false`) — no DB access, no throw at boot.
- Reuse the shared VAPID config `@config/push.config.js` (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`). Do **not** add new env vars.
- Payload shape sent to the client SW: `{ title: string; body: string; navigate_to?: string | null; tag?: string }` (identical to staff `ProfilePushPayload`).
- Patient endpoints authenticate with `PatientJwtAuthGuard` + `@Public()` (to skip the org-scoped staff guard) and read the account via `@CurrentPatient()` → `accountId`.
- `migrate:check` (`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`) must pass with a committed migration for the new model.

---

### Task 1: Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma` (add `PatientPushSubscription` model; add relation field to `PatientAccount`)
- Create: `prisma/migrations/<timestamp>_add_patient_push_subscriptions/migration.sql` (generated)

**Interfaces:**
- Produces: Prisma model `patientPushSubscription` with fields `id, account_id, endpoint (unique), p256dh, auth, user_agent, created_at, updated_at`; relation `PatientAccount.push_subscriptions`.

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Add this model (mirrors `AdminPushSubscription`, keyed to `PatientAccount`):

```prisma
model PatientPushSubscription {
  id         String         @id @default(uuid()) @db.Uuid
  account_id String         @db.Uuid
  account    PatientAccount @relation(fields: [account_id], references: [id], onDelete: Cascade)
  endpoint   String         @unique
  p256dh     String
  auth       String
  user_agent String?
  created_at DateTime       @default(now())
  updated_at DateTime       @updatedAt

  @@index([account_id])
  @@map("patient_push_subscriptions")
}
```

- [ ] **Step 2: Add the back-relation on `PatientAccount`**

In `model PatientAccount`, add this line next to `refreshTokens RefreshToken[]`:

```prisma
  push_subscriptions     PatientPushSubscription[]
```

- [ ] **Step 3: Generate the migration**

Run: `npx prisma migrate dev --name add_patient_push_subscriptions`
Expected: a new folder under `prisma/migrations/` containing `migration.sql` that `CREATE TABLE "patient_push_subscriptions"` with a unique index on `endpoint` and an index on `account_id`; Prisma Client regenerates.

(If no dev database is reachable, generate SQL only with
`npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script > prisma/migrations/<timestamp>_add_patient_push_subscriptions/migration.sql` and create the folder manually.)

- [ ] **Step 4: Verify schema/migration parity**

Run: `npm run migrate:check`
Expected: exit code 0 (no diff between the migration state and `schema.prisma`).

- [ ] **Step 5: Verify the client compiles**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: no errors; `prisma.db.patientPushSubscription` is now typed.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(push): add PatientPushSubscription model + migration"
```

---

### Task 2: PatientPushService (subscribe / unsubscribe / sendToPatient)

**Files:**
- Create: `src/core/patient-portal/push/patient-push.service.ts`
- Create: `src/core/patient-portal/push/dto/patient-push.dto.ts`
- Test: `src/core/patient-portal/push/patient-push.service.spec.ts`

**Interfaces:**
- Consumes: `pushConfig` (`@config/push.config.js`), `PrismaService` (`@infrastructure/database/prisma.service.js`), `web-push`.
- Produces:
  - `PatientPushPayload = { title: string; body: string; navigate_to?: string | null; tag?: string }`
  - `class PatientPushService` with:
    - `onModuleInit(): void`
    - `subscribe(accountId: string, dto: PushSubscribeDto, userAgent?: string | null): Promise<void>`
    - `unsubscribe(accountId: string, endpoint: string): Promise<void>`
    - `sendToPatient(patientId: string, payload: PatientPushPayload): void`
  - DTOs `PushSubscribeDto`, `PushUnsubscribeDto`, `PushSubscriptionKeysDto` (identical shape to the admin/staff DTOs).

- [ ] **Step 1: Write the DTOs**

Create `src/core/patient-portal/push/dto/patient-push.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsString,
  ValidateNested,
} from 'class-validator';

/** The two keys a browser PushSubscription exposes for message encryption. */
export class PushSubscriptionKeysDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  auth!: string;
}

/** Body of `POST /v1/patient-portal/push/subscribe` — a serialized PushSubscription. */
export class PushSubscribeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  endpoint!: string;

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;
}

/** Body of `POST /v1/patient-portal/push/unsubscribe`. */
export class PushUnsubscribeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  endpoint!: string;
}
```

- [ ] **Step 2: Write the failing service spec**

Create `src/core/patient-portal/push/patient-push.service.spec.ts` (mirrors `src/core/notifications/push.service.spec.ts`, adapted to the account fan-out):

```ts
import type { ConfigType } from '@nestjs/config';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type pushConfig from '@config/push.config.js';

const mockSetVapidDetails = jest.fn();
const mockSendNotification = jest.fn();

jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: (...args: unknown[]) => mockSetVapidDetails(...args),
    sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  },
}));

import { PatientPushService } from './patient-push.service.js';

type PushConfig = ConfigType<typeof pushConfig>;

const enabledConfig: PushConfig = {
  enabled: true,
  subject: 'mailto:team@cradlen.com',
  publicKey: 'pub',
  privateKey: 'priv',
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

function webPushError(statusCode: number): Error {
  return Object.assign(new Error(`web-push ${statusCode}`), { statusCode });
}

/**
 * Prisma double. `patientGuardian.findMany` returns guardian links,
 * `patientAccount.findMany` returns accessible accounts, and
 * `patientPushSubscription.*` back the subscription reads/writes.
 */
function makePrisma(overrides?: {
  guardianLinks?: Array<{ guardian_id: string }>;
  accounts?: Array<{ id: string }>;
  subs?: Array<{ endpoint: string; p256dh: string; auth: string }>;
  upsert?: jest.Mock;
  subDeleteMany?: jest.Mock;
}) {
  const guardianFindMany = jest
    .fn()
    .mockResolvedValue(overrides?.guardianLinks ?? []);
  const accountFindMany = jest
    .fn()
    .mockResolvedValue(overrides?.accounts ?? []);
  const subFindMany = jest.fn().mockResolvedValue(overrides?.subs ?? []);
  const subDeleteMany =
    overrides?.subDeleteMany ?? jest.fn().mockResolvedValue({ count: 0 });
  const upsert = overrides?.upsert ?? jest.fn().mockResolvedValue(undefined);
  const prisma = {
    db: {
      patientGuardian: { findMany: guardianFindMany },
      patientAccount: { findMany: accountFindMany },
      patientPushSubscription: {
        findMany: subFindMany,
        deleteMany: subDeleteMany,
        upsert,
      },
    },
  } as unknown as PrismaService;
  return {
    prisma,
    guardianFindMany,
    accountFindMany,
    subFindMany,
    subDeleteMany,
    upsert,
  };
}

describe('PatientPushService', () => {
  beforeEach(() => {
    mockSetVapidDetails.mockReset();
    mockSendNotification.mockReset();
  });

  describe('onModuleInit', () => {
    it('configures VAPID when enabled', () => {
      const { prisma } = makePrisma();
      new PatientPushService(enabledConfig, prisma).onModuleInit();
      expect(mockSetVapidDetails).toHaveBeenCalledWith(
        'mailto:team@cradlen.com',
        'pub',
        'priv',
      );
    });

    it('stays inert (no DB, no throw) when disabled', () => {
      const { prisma, accountFindMany } = makePrisma();
      const service = new PatientPushService(
        { ...enabledConfig, enabled: false },
        prisma,
      );
      service.onModuleInit();
      expect(mockSetVapidDetails).not.toHaveBeenCalled();
      service.sendToPatient('patient-1', { title: 't', body: 'b' });
      expect(accountFindMany).not.toHaveBeenCalled();
    });

    it('boots and stays disabled when setVapidDetails throws', () => {
      mockSetVapidDetails.mockImplementation(() => {
        throw new Error('Vapid subject is not a url or mailto url');
      });
      const { prisma, accountFindMany } = makePrisma();
      const service = new PatientPushService(enabledConfig, prisma);
      expect(() => service.onModuleInit()).not.toThrow();
      service.sendToPatient('patient-1', { title: 't', body: 'b' });
      expect(accountFindMany).not.toHaveBeenCalled();
    });
  });

  describe('sendToPatient fan-out', () => {
    it('resolves the patient own account + guardian accounts and pushes to all their subs', async () => {
      const { prisma, guardianFindMany, accountFindMany, subFindMany } =
        makePrisma({
          guardianLinks: [{ guardian_id: 'g-1' }],
          accounts: [{ id: 'acc-self' }, { id: 'acc-guardian' }],
          subs: [
            { endpoint: 'e-1', p256dh: 'a', auth: 'b' },
            { endpoint: 'e-2', p256dh: 'a', auth: 'b' },
          ],
        });
      mockSendNotification.mockResolvedValue(undefined);
      const service = new PatientPushService(enabledConfig, prisma);
      service.onModuleInit();

      service.sendToPatient('patient-1', {
        title: 't',
        body: 'b',
        tag: 'n-1',
      });
      await flush();

      expect(guardianFindMany).toHaveBeenCalledWith({
        where: { patient_id: 'patient-1', is_deleted: false },
        select: { guardian_id: true },
      });
      expect(accountFindMany).toHaveBeenCalledWith({
        where: {
          is_active: true,
          is_deleted: false,
          OR: [{ patient_id: 'patient-1' }, { guardian_id: { in: ['g-1'] } }],
        },
        select: { id: true },
      });
      expect(subFindMany).toHaveBeenCalledWith({
        where: { account_id: { in: ['acc-self', 'acc-guardian'] } },
      });
      expect(mockSendNotification).toHaveBeenCalledTimes(2);
    });

    it('queries only the patient own account when there are no guardians', async () => {
      const { prisma, accountFindMany } = makePrisma({
        guardianLinks: [],
        accounts: [{ id: 'acc-self' }],
        subs: [],
      });
      const service = new PatientPushService(enabledConfig, prisma);
      service.onModuleInit();

      service.sendToPatient('patient-1', { title: 't', body: 'b' });
      await flush();

      expect(accountFindMany).toHaveBeenCalledWith({
        where: {
          is_active: true,
          is_deleted: false,
          OR: [{ patient_id: 'patient-1' }],
        },
        select: { id: true },
      });
    });

    it('prunes only 404/410 subscriptions', async () => {
      const { prisma, subDeleteMany } = makePrisma({
        accounts: [{ id: 'acc-self' }],
        subs: [
          { endpoint: 'e-ok', p256dh: 'a', auth: 'b' },
          { endpoint: 'e-gone', p256dh: 'a', auth: 'b' },
          { endpoint: 'e-5xx', p256dh: 'a', auth: 'b' },
        ],
      });
      mockSendNotification.mockImplementation((sub: { endpoint: string }) => {
        if (sub.endpoint === 'e-gone') return Promise.reject(webPushError(410));
        if (sub.endpoint === 'e-5xx') return Promise.reject(webPushError(500));
        return Promise.resolve();
      });
      const service = new PatientPushService(enabledConfig, prisma);
      service.onModuleInit();

      service.sendToPatient('patient-1', { title: 't', body: 'b' });
      await flush();

      expect(subDeleteMany).toHaveBeenCalledWith({
        where: { endpoint: { in: ['e-gone'] } },
      });
    });

    it('no-ops when no accessible account has a subscription', async () => {
      const { prisma } = makePrisma({
        accounts: [{ id: 'acc-self' }],
        subs: [],
      });
      const service = new PatientPushService(enabledConfig, prisma);
      service.onModuleInit();

      service.sendToPatient('patient-1', { title: 't', body: 'b' });
      await flush();

      expect(mockSendNotification).not.toHaveBeenCalled();
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('upserts a subscription keyed by its unique endpoint', async () => {
      const { prisma, upsert } = makePrisma();
      await new PatientPushService(enabledConfig, prisma).subscribe(
        'acc-1',
        { endpoint: 'e-1', keys: { p256dh: 'a', auth: 'b' } },
        'UA/1.0',
      );
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { endpoint: 'e-1' } }),
      );
    });

    it('deletes only the endpoint owned by the caller (account-scoped)', async () => {
      const { prisma, subDeleteMany } = makePrisma();
      await new PatientPushService(enabledConfig, prisma).unsubscribe(
        'acc-1',
        'e-1',
      );
      expect(subDeleteMany).toHaveBeenCalledWith({
        where: { endpoint: 'e-1', account_id: 'acc-1' },
      });
    });
  });
});
```

- [ ] **Step 3: Run the spec to verify it fails**

Run: `npx jest src/core/patient-portal/push/patient-push.service.spec.ts`
Expected: FAIL — `Cannot find module './patient-push.service.js'`.

- [ ] **Step 4: Implement the service**

Create `src/core/patient-portal/push/patient-push.service.ts`:

```ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import webpush from 'web-push';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import pushConfig from '@config/push.config.js';
import type { PushSubscribeDto } from './dto/patient-push.dto.js';

/**
 * Shape of the JSON the patient service worker expects in a push message.
 * Mirrors `PushPayload` in cradlen-patient `src/app/sw.ts` and staff
 * `ProfilePushPayload`.
 */
export interface PatientPushPayload {
  title: string;
  body: string;
  navigate_to?: string | null;
  /** De-dupe key on the client; we pass the notification id so messages don't collapse. */
  tag?: string;
}

/**
 * Stores patient browser push subscriptions and fans a patient's notifications
 * out to every account that can access that patient — the patient's own login
 * account plus any guardian accounts. Delivery is best-effort: it never throws
 * into the caller (safe to call from the notifications listener), and
 * subscriptions the push service reports as gone (404/410) are pruned. Stays
 * inert when no VAPID keypair is configured. Mirrors PushService.
 */
@Injectable()
export class PatientPushService implements OnModuleInit {
  private readonly logger = new Logger(PatientPushService.name);
  private enabled = false;

  constructor(
    @Inject(pushConfig.KEY)
    private readonly config: ConfigType<typeof pushConfig>,
    private readonly prismaService: PrismaService,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.warn(
        'Web Push disabled: VAPID keys are missing or the subject is invalid.',
      );
      return;
    }
    try {
      webpush.setVapidDetails(
        this.config.subject,
        this.config.publicKey,
        this.config.privateKey,
      );
      this.enabled = true;
    } catch (error) {
      this.logger.error(
        `Web Push disabled: failed to configure VAPID details (subject "${this.config.subject}"). ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Register (or refresh) a subscription. Endpoint is unique, so re-subscribe upserts. */
  async subscribe(
    accountId: string,
    dto: PushSubscribeDto,
    userAgent?: string | null,
  ): Promise<void> {
    await this.prismaService.db.patientPushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        account_id: accountId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        user_agent: userAgent ?? null,
      },
      update: {
        account_id: accountId,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        user_agent: userAgent ?? null,
      },
    });
  }

  /** Remove a subscription owned by this account (scoped to avoid cross-account deletes). */
  async unsubscribe(accountId: string, endpoint: string): Promise<void> {
    await this.prismaService.db.patientPushSubscription.deleteMany({
      where: { endpoint, account_id: accountId },
    });
  }

  /**
   * Fire-and-forget fan-out to every device of every account that can access
   * `patientId`. Safe to call from a hot path.
   */
  sendToPatient(patientId: string, payload: PatientPushPayload): void {
    if (!this.enabled) return;
    void this.dispatch(patientId, payload);
  }

  private async dispatch(
    patientId: string,
    payload: PatientPushPayload,
  ): Promise<void> {
    try {
      // 1. Resolve every account that can access this patient: the patient's
      //    own login account, plus any guardian accounts linked to them.
      const guardianLinks =
        await this.prismaService.db.patientGuardian.findMany({
          where: { patient_id: patientId, is_deleted: false },
          select: { guardian_id: true },
        });
      const guardianIds = guardianLinks.map((l) => l.guardian_id);

      const accounts = await this.prismaService.db.patientAccount.findMany({
        where: {
          is_active: true,
          is_deleted: false,
          OR: [
            { patient_id: patientId },
            ...(guardianIds.length > 0
              ? [{ guardian_id: { in: guardianIds } }]
              : []),
          ],
        },
        select: { id: true },
      });
      const accountIds = accounts.map((a) => a.id);
      if (accountIds.length === 0) return;

      // 2. Load their subscriptions and push.
      const subs =
        await this.prismaService.db.patientPushSubscription.findMany({
          where: { account_id: { in: accountIds } },
        });
      if (subs.length === 0) return;

      const body = JSON.stringify(payload);
      const stale: string[] = [];

      await Promise.all(
        subs.map(async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              body,
            );
          } catch (error) {
            const statusCode = (error as { statusCode?: number }).statusCode;
            if (statusCode === 404 || statusCode === 410) {
              stale.push(sub.endpoint);
            } else {
              this.logger.warn(
                `Push send failed (status ${statusCode ?? 'n/a'}) for ${sub.endpoint}`,
              );
            }
          }
        }),
      );

      if (stale.length > 0) {
        await this.prismaService.db.patientPushSubscription.deleteMany({
          where: { endpoint: { in: stale } },
        });
        this.logger.log(`Pruned ${stale.length} expired push subscription(s).`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to dispatch patient push notifications for patient ${patientId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `npx jest src/core/patient-portal/push/patient-push.service.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/core/patient-portal/push/patient-push.service.ts \
        src/core/patient-portal/push/patient-push.service.spec.ts \
        src/core/patient-portal/push/dto/patient-push.dto.ts
git commit -m "feat(push): PatientPushService with account fan-out dispatch"
```

---

### Task 3: Controller + module (endpoints)

**Files:**
- Create: `src/core/patient-portal/push/patient-push.controller.ts`
- Create: `src/core/patient-portal/push/patient-push.module.ts`
- Modify: `src/app.module.ts` (register `PatientPushModule`)
- Test: `src/core/patient-portal/push/patient-push.controller.spec.ts`

**Interfaces:**
- Consumes: `PatientPushService` (Task 2); `PatientJwtAuthGuard` (`@common/guards/patient-jwt-auth.guard.js`); `CurrentPatient` (`@common/decorators/current-patient.decorator.js`); `Public` (`@common/decorators/public.decorator.js`); `PatientAuthContext` (`@common/interfaces/patient-auth-context.interface.js`) — has `accountId: string`.
- Produces: `POST /v1/patient-portal/push/subscribe` and `.../unsubscribe`, both returning `{ success: boolean }`; `PatientPushModule` (global, exports `PatientPushService`).

- [ ] **Step 1: Write the failing controller spec**

Create `src/core/patient-portal/push/patient-push.controller.spec.ts`:

```ts
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientPushController } from './patient-push.controller.js';
import type { PatientPushService } from './patient-push.service.js';

const ctx: PatientAuthContext = {
  accountId: 'acc-1',
  accessiblePatientIds: ['patient-1'],
};

function makeService() {
  return {
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
  } as unknown as PatientPushService;
}

describe('PatientPushController', () => {
  it('subscribe passes the accountId, dto, and user-agent to the service', async () => {
    const service = makeService();
    const controller = new PatientPushController(service);
    const dto = { endpoint: 'e-1', keys: { p256dh: 'a', auth: 'b' } };

    const result = await controller.subscribe(ctx, dto, 'UA/1.0');

    expect(service.subscribe).toHaveBeenCalledWith('acc-1', dto, 'UA/1.0');
    expect(result).toEqual({ success: true });
  });

  it('unsubscribe passes the accountId and endpoint to the service', async () => {
    const service = makeService();
    const controller = new PatientPushController(service);

    const result = await controller.unsubscribe(ctx, { endpoint: 'e-1' });

    expect(service.unsubscribe).toHaveBeenCalledWith('acc-1', 'e-1');
    expect(result).toEqual({ success: true });
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npx jest src/core/patient-portal/push/patient-push.controller.spec.ts`
Expected: FAIL — cannot find `./patient-push.controller.js`.

- [ ] **Step 3: Implement the controller**

Create `src/core/patient-portal/push/patient-push.controller.ts`:

```ts
import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentPatient } from '@common/decorators/current-patient.decorator.js';
import { PatientJwtAuthGuard } from '@common/guards/patient-jwt-auth.guard.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientPushService } from './patient-push.service.js';
import { PushSubscribeDto, PushUnsubscribeDto } from './dto/patient-push.dto.js';

/**
 * Web Push subscription management for the patient portal. `@Public()` to skip
 * the org-scoped staff guard, then re-protected by PatientJwtAuthGuard. Each
 * subscription is owned by the calling login account (`accountId` from the JWT),
 * so a guardian's device is reachable for every dependent they manage.
 */
@ApiTags('Patient Portal')
@ApiBearerAuth()
@Public()
@UseGuards(PatientJwtAuthGuard)
@Controller({ path: 'patient-portal/push', version: '1' })
export class PatientPushController {
  constructor(private readonly push: PatientPushService) {}

  @Post('subscribe')
  @ApiOperation({ summary: 'Register a Web Push subscription for this account' })
  async subscribe(
    @CurrentPatient() patient: PatientAuthContext,
    @Body() dto: PushSubscribeDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ success: boolean }> {
    await this.push.subscribe(patient.accountId, dto, userAgent ?? null);
    return { success: true };
  }

  @Post('unsubscribe')
  @ApiOperation({ summary: 'Remove a Web Push subscription' })
  async unsubscribe(
    @CurrentPatient() patient: PatientAuthContext,
    @Body() dto: PushUnsubscribeDto,
  ): Promise<{ success: boolean }> {
    await this.push.unsubscribe(patient.accountId, dto.endpoint);
    return { success: true };
  }
}
```

- [ ] **Step 4: Implement the module**

Create `src/core/patient-portal/push/patient-push.module.ts` (global, like `AdminPushModule`, so the notifications listener can inject `PatientPushService`):

```ts
import { Global, Module } from '@nestjs/common';
import { PatientPushController } from './patient-push.controller.js';
import { PatientPushService } from './patient-push.service.js';

/**
 * Patient Web Push: subscription endpoints + the fan-out service. Global so the
 * patient notifications listener can inject PatientPushService to push on every
 * new notification, mirroring AdminPushModule. PrismaService is global.
 */
@Global()
@Module({
  controllers: [PatientPushController],
  providers: [PatientPushService],
  exports: [PatientPushService],
})
export class PatientPushModule {}
```

- [ ] **Step 5: Register the module in `src/app.module.ts`**

Add the import near the other `@core/...` module imports:

```ts
import { PatientPushModule } from '@core/patient-portal/push/patient-push.module.js';
```

Add `PatientPushModule` to the `imports` array (next to `PatientNotificationsModule`).

- [ ] **Step 6: Run the controller spec + typecheck**

Run: `npx jest src/core/patient-portal/push/patient-push.controller.spec.ts && npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/patient-portal/push/patient-push.controller.ts \
        src/core/patient-portal/push/patient-push.controller.spec.ts \
        src/core/patient-portal/push/patient-push.module.ts \
        src/app.module.ts
git commit -m "feat(push): patient push subscribe/unsubscribe endpoints"
```

---

### Task 4: Dispatch hook in the notifications listener

**Files:**
- Modify: `src/core/patient-portal/notifications/patient-notifications.listener.ts`
- Test: `src/core/patient-portal/notifications/patient-notifications.listener.spec.ts` (create if absent)

**Interfaces:**
- Consumes: `PatientPushService.sendToPatient(patientId, { title, body, navigate_to, tag })` (Task 2), injected into the listener.
- Produces: a push dispatched after every `patientNotifications.create(...)`.

- [ ] **Step 1: Write the failing listener spec**

Create `src/core/patient-portal/notifications/patient-notifications.listener.spec.ts`. It drives `handleInvestigationReviewed` (the simplest path — payload carries `patient_id`) and asserts a push is dispatched with the created notification's fields:

```ts
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientNotificationsService } from './patient-notifications.service.js';
import type { PatientPushService } from '@core/patient-portal/push/patient-push.service.js';
import type { InvestigationReviewedEvent } from '@core/clinical/events/events.public.js';
import { PatientNotificationsListener } from './patient-notifications.listener.js';

function makeDeps(created: {
  patient_id: string;
  title: string;
  description: string;
  navigate_to: string | null;
  id: string;
}) {
  const prisma = {} as unknown as PrismaService;
  const notifications = {
    create: jest.fn().mockResolvedValue(created),
  } as unknown as PatientNotificationsService;
  const push = {
    sendToPatient: jest.fn(),
  } as unknown as PatientPushService;
  return { prisma, notifications, push };
}

const reviewedEvent = {
  patient_id: 'patient-1',
  organization_id: 'org-1',
  investigation_id: 'inv-1',
  visit_id: 'visit-1',
  test_name: 'CBC',
} as unknown as InvestigationReviewedEvent;

describe('PatientNotificationsListener push dispatch', () => {
  it('pushes to the patient after creating an investigation-reviewed notification', async () => {
    const created = {
      id: 'notif-1',
      patient_id: 'patient-1',
      title: 'Result reviewed',
      description: 'Your CBC result has been reviewed.',
      navigate_to: '/tests',
    };
    const { prisma, notifications, push } = makeDeps(created);
    const listener = new PatientNotificationsListener(
      prisma,
      notifications,
      push,
    );

    await listener.handleInvestigationReviewed(reviewedEvent);

    expect(push.sendToPatient).toHaveBeenCalledWith('patient-1', {
      title: created.title,
      body: created.description,
      navigate_to: created.navigate_to,
      tag: created.id,
    });
  });

  it('does not throw out of the handler when create fails', async () => {
    const prisma = {} as unknown as PrismaService;
    const notifications = {
      create: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as PatientNotificationsService;
    const push = { sendToPatient: jest.fn() } as unknown as PatientPushService;
    const listener = new PatientNotificationsListener(
      prisma,
      notifications,
      push,
    );

    await expect(
      listener.handleInvestigationReviewed(reviewedEvent),
    ).resolves.toBeUndefined();
    expect(push.sendToPatient).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npx jest src/core/patient-portal/notifications/patient-notifications.listener.spec.ts`
Expected: FAIL — the listener constructor takes 2 args, and `sendToPatient` is never called.

- [ ] **Step 3: Inject the service and dispatch after each create**

In `patient-notifications.listener.ts`:

Add the import:

```ts
import { PatientPushService } from '@core/patient-portal/push/patient-push.service.js';
```

Add the third constructor parameter:

```ts
  constructor(
    private readonly prismaService: PrismaService,
    private readonly patientNotifications: PatientNotificationsService,
    private readonly patientPush: PatientPushService,
  ) {}
```

After **each** `await this.patientNotifications.create({...})` call, capture the result and dispatch. There are three create calls (prescription, investigation-ordered, investigation-reviewed); wrap each like this — e.g. the prescription block becomes:

```ts
      if (hasPrescription) {
        const notification = await this.patientNotifications.create({
          patientId: journey.patient_id,
          organizationId: journey.organization_id,
          code: PATIENT_NOTIFICATION_CODES.VISIT_PRESCRIPTION_ISSUED.code,
          category:
            PATIENT_NOTIFICATION_CODES.VISIT_PRESCRIPTION_ISSUED.category,
          title:
            PATIENT_NOTIFICATION_CODES.VISIT_PRESCRIPTION_ISSUED.defaultTitle,
          description: 'Your doctor prescribed new medication for you.',
          navigateTo: '/medications',
          metadata: { visitId },
        });
        this.patientPush.sendToPatient(notification.patient_id, {
          title: notification.title,
          body: notification.description,
          navigate_to: notification.navigate_to,
          tag: notification.id,
        });
      }
```

Apply the same `const notification = await ...create(...)` + `this.patientPush.sendToPatient(...)` treatment to the investigation-ordered block in `handleVisitStatusUpdated` and to the single create in `handleInvestigationReviewed`. The `sendToPatient` call is fire-and-forget (returns void) and sits inside the existing `try` blocks, so a failure never escapes.

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npx jest src/core/patient-portal/notifications/patient-notifications.listener.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full backend verification**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run migrate:check`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/core/patient-portal/notifications/patient-notifications.listener.ts \
        src/core/patient-portal/notifications/patient-notifications.listener.spec.ts
git commit -m "feat(push): dispatch patient push on notification creation"
```

---

## Self-Review Notes

- **Spec coverage:** model + migration (Task 1), service with fan-out + prune + inert-when-disabled (Task 2), endpoints with patient guard (Task 3), dispatch on the existing events (Task 4). `migrate:check` gate covered in Tasks 1 and 4.
- **Type consistency:** `sendToPatient(patientId, PatientPushPayload)`, `subscribe(accountId, PushSubscribeDto, userAgent?)`, `unsubscribe(accountId, endpoint)` used identically in service, controller, and listener. `PatientAuthContext.accountId` is the ownership key throughout.
- **Out of scope here:** VAPID key generation/ops and the frontend live in the companion frontend plan; this backend degrades gracefully when VAPID is unset.
