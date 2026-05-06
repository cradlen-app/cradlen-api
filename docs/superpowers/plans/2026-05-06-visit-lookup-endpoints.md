# Visit Lookup Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `?role=` filter to the staff listing endpoint and a new `GET /branches/:branchId/visits?status=` endpoint for branch-level visit lookups.

**Architecture:** Two isolated changes — (1) add an optional `role` query param to the existing `listStaff` service method and controller route; (2) add a new `findAllForBranch` method to `VisitsService` and a new controller route that filters visits by branch + status, using JWT-carried `roles` and `branchIds` for fast access control.

**Tech Stack:** NestJS v11, Prisma v7, class-validator, Jest

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `src/modules/staff/staff.service.ts` | Add `role?` param to `listStaff`, add role filter to Prisma `where` |
| Modify | `src/modules/staff/staff.controller.ts` | Add `@Query('role') role?` to `listStaff` handler |
| Create | `src/modules/staff/staff.service.spec.ts` | Unit tests for role-filtered `listStaff` |
| Modify | `src/modules/visits/visits.service.ts` | Add `findAllForBranch` method |
| Modify | `src/modules/visits/visits.controller.ts` | Add `GET /branches/:branchId/visits` route with inline DTO |
| Modify | `src/modules/visits/visits.service.spec.ts` | Unit tests for `findAllForBranch` |

---

## Task 1: Add `role` filter to `listStaff` service

**Files:**
- Modify: `src/modules/staff/staff.service.ts:121-168`

- [ ] **Step 1: Update `listStaff` signature and Prisma where clause**

In `src/modules/staff/staff.service.ts`, update the `listStaff` method:

```ts
async listStaff(
  profileId: string,
  organizationId: string,
  branchId?: string,
  role?: string,
) {
  await this.authorizationService.assertCanManageStaff(
    profileId,
    organizationId,
  );

  const where: Prisma.ProfileWhereInput = {
    organization_id: organizationId,
    is_deleted: false,
    is_active: true,
  };
  if (branchId) {
    where.branches = { some: { branch_id: branchId } };
  }
  if (role) {
    where.roles = { some: { role: { name: role.toUpperCase() } } };
  }

  const profiles = await this.prismaService.db.profile.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          email: true,
          phone_number: true,
        },
      },
      roles: { include: { role: true } },
      branches: {
        where: { branch: { is_deleted: false } },
        include: { branch: true },
      },
      workingSchedules: {
        include: {
          days: {
            include: { shifts: true },
          },
        },
      },
    },
    orderBy: { created_at: 'asc' },
  });

  return profiles.map((p) => this.toStaffResponse(p));
}
```

- [ ] **Step 2: Commit service change**

```bash
git add src/modules/staff/staff.service.ts
git commit -m "feat(staff): add optional role filter to listStaff"
```

---

## Task 2: Wire `role` query param in staff controller

**Files:**
- Modify: `src/modules/staff/staff.controller.ts:44-57`

- [ ] **Step 1: Add `role` query param**

Update the `listStaff` handler in `src/modules/staff/staff.controller.ts`:

```ts
@Get('organizations/:organizationId/staff')
@ApiOperation({ summary: 'List all active staff in an organization' })
@ApiStandardResponse(Object)
listStaff(
  @CurrentUser() user: AuthContext,
  @Param('organizationId', ParseUUIDPipe) organizationId: string,
  @Query('branch_id') branchId?: string,
  @Query('role') role?: string,
) {
  return this.staffService.listStaff(
    user.profileId,
    organizationId,
    branchId,
    role,
  );
}
```

- [ ] **Step 2: Commit controller change**

```bash
git add src/modules/staff/staff.controller.ts
git commit -m "feat(staff): expose role query param on GET /staff"
```

---

## Task 3: Unit tests for `listStaff` role filter

**Files:**
- Create: `src/modules/staff/staff.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `src/modules/staff/staff.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { StaffService } from './staff.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService } from '../../common/authorization/authorization.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

const mockDoctorProfile = {
  id: 'prof-uuid',
  user_id: 'user-uuid',
  job_title: 'Gynecologist',
  specialty: 'Gynecology',
  is_clinical: true,
  user: {
    id: 'user-uuid',
    first_name: 'Ahmed',
    last_name: 'Ali',
    email: 'ahmed@cradlen.com',
    phone_number: '+201234567890',
  },
  roles: [{ role: { id: 'role-uuid', name: 'DOCTOR' } }],
  branches: [
    {
      branch: {
        id: 'branch-uuid',
        name: 'Main Branch',
        city: 'Cairo',
        governorate: 'Cairo',
      },
    },
  ],
  workingSchedules: [],
};

describe('StaffService.listStaff', () => {
  let service: StaffService;
  let db: {
    profile: { findMany: jest.Mock };
  };
  let authMock: { assertCanManageStaff: jest.Mock };

  beforeEach(async () => {
    db = { profile: { findMany: jest.fn() } };
    authMock = { assertCanManageStaff: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: PrismaService, useValue: { db } },
        { provide: AuthorizationService, useValue: authMock },
        {
          provide: SubscriptionsService,
          useValue: { assertStaffLimit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<StaffService>(StaffService);
  });

  it('returns all staff when no role filter is given', async () => {
    db.profile.findMany.mockResolvedValue([mockDoctorProfile]);
    const result = await service.listStaff('caller-uuid', 'org-uuid');
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ roles: expect.anything() }),
      }),
    );
    expect(result).toHaveLength(1);
  });

  it('adds role filter to where clause when role is provided', async () => {
    db.profile.findMany.mockResolvedValue([mockDoctorProfile]);
    await service.listStaff('caller-uuid', 'org-uuid', undefined, 'DOCTOR');
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roles: { some: { role: { name: 'DOCTOR' } } },
        }),
      }),
    );
  });

  it('normalises role to uppercase', async () => {
    db.profile.findMany.mockResolvedValue([mockDoctorProfile]);
    await service.listStaff('caller-uuid', 'org-uuid', undefined, 'doctor');
    expect(db.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roles: { some: { role: { name: 'DOCTOR' } } },
        }),
      }),
    );
  });

  it('throws ForbiddenException when caller is not OWNER', async () => {
    authMock.assertCanManageStaff.mockRejectedValue(new ForbiddenException());
    await expect(
      service.listStaff('caller-uuid', 'org-uuid'),
    ).rejects.toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/modules/staff/staff.service.spec.ts --no-coverage
```

Expected: FAIL — `adds role filter` and `normalises role` tests fail because the filter isn't wired yet (Task 1 adds it; if running in order they will pass — run this step before Task 1 to confirm the test catches the gap).

- [ ] **Step 3: Run tests again after Tasks 1–2 to confirm they pass**

```bash
npx jest src/modules/staff/staff.service.spec.ts --no-coverage
```

Expected: all 4 tests PASS.

- [ ] **Step 4: Commit tests**

```bash
git add src/modules/staff/staff.service.spec.ts
git commit -m "test(staff): unit tests for listStaff role filter"
```

---

## Task 4: Add `findAllForBranch` to visits service

**Files:**
- Modify: `src/modules/visits/visits.service.ts`

- [ ] **Step 1: Add imports and method**

Add the following import at the top of `src/modules/visits/visits.service.ts` (it is already imported, just confirming `VisitStatus` is available from `@prisma/client`):

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
```

Replace the existing import line:
```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
```

With:
```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
```

Then add the `findAllForBranch` method to the `VisitsService` class, after `findAllForEpisode`:

```ts
async findAllForBranch(
  branchId: string,
  status: VisitStatus,
  query: { page?: number; limit?: number },
  user: AuthContext,
) {
  const branch = await this.prismaService.db.branch.findFirst({
    where: {
      id: branchId,
      organization_id: user.organizationId,
      is_deleted: false,
    },
    select: { id: true },
  });
  if (!branch) throw new NotFoundException(`Branch ${branchId} not found`);

  const isOwner = user.roles.includes('OWNER');
  const isInBranch = user.branchIds.includes(branchId);
  if (!isOwner && !isInBranch) {
    throw new ForbiddenException('Access denied');
  }

  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const where = { branch_id: branchId, status, is_deleted: false };

  const [visits, total] = await this.prismaService.db.$transaction([
    this.prismaService.db.visit.findMany({
      where,
      orderBy: { scheduled_at: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        assigned_doctor: {
          select: {
            id: true,
            specialty: true,
            user: { select: { id: true, first_name: true, last_name: true } },
          },
        },
        episode: {
          select: {
            id: true,
            journey: {
              select: {
                patient: { select: { id: true, full_name: true } },
              },
            },
          },
        },
      },
    }),
    this.prismaService.db.visit.count({ where }),
  ]);

  return paginated(visits, { page, limit, total });
}
```

- [ ] **Step 2: Commit service change**

```bash
git add src/modules/visits/visits.service.ts
git commit -m "feat(visits): add findAllForBranch with status filter"
```

---

## Task 5: Add `GET /branches/:branchId/visits` route to visits controller

**Files:**
- Modify: `src/modules/visits/visits.controller.ts`

- [ ] **Step 1: Add import and inline DTO + route**

Add `IsEnum`, `IsNotEmpty` to the existing class-validator import and add `ParseUUIDPipe` to the nestjs/common import. Then add the inline query DTO and route:

Update imports at the top of `src/modules/visits/visits.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { VisitStatus } from '@prisma/client';
```

Add the new DTO class after the existing `ListVisitsQueryDto`:

```ts
class ListBranchVisitsQueryDto {
  @IsNotEmpty() @IsEnum(VisitStatus) status!: VisitStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}
```

Add the new route at the end of `VisitsController`, before the closing `}`:

```ts
@Get('branches/:branchId/visits')
@ApiPaginatedResponse(VisitDto)
findAllForBranch(
  @Param('branchId', ParseUUIDPipe) branchId: string,
  @Query() query: ListBranchVisitsQueryDto,
  @CurrentUser() user: AuthContext,
) {
  return this.visitsService.findAllForBranch(
    branchId,
    query.status,
    { page: query.page, limit: query.limit },
    user,
  );
}
```

- [ ] **Step 2: Commit controller change**

```bash
git add src/modules/visits/visits.controller.ts
git commit -m "feat(visits): add GET /branches/:branchId/visits route"
```

---

## Task 6: Unit tests for `findAllForBranch`

**Files:**
- Modify: `src/modules/visits/visits.service.spec.ts`

- [ ] **Step 1: Add `branch` mock to the existing `db` object**

In the `db` declaration block inside `describe('VisitsService')`, add `branch`:

```ts
let db: {
  patientEpisode: { findUnique: jest.Mock; findFirst: jest.Mock; createMany: jest.Mock };
  patient: { findUnique: jest.Mock; create: jest.Mock };
  patientJourney: { findFirst: jest.Mock; create: jest.Mock };
  journeyTemplate: { findFirst: jest.Mock };
  branch: { findFirst: jest.Mock };
  visit: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock; count: jest.Mock };
  $transaction: jest.Mock;
};
```

And in `beforeEach`, add to the `db` initializer:

```ts
branch: { findFirst: jest.fn() },
```

- [ ] **Step 2: Add test suite for `findAllForBranch`**

Add this `describe` block at the end of the file, inside the outer `describe('VisitsService')`:

```ts
describe('findAllForBranch', () => {
  const ownerUser: AuthContext = {
    userId: 'user-uuid',
    profileId: 'profile-uuid',
    organizationId: 'org-uuid',
    activeBranchId: 'branch-uuid',
    roles: ['OWNER'],
    branchIds: ['branch-uuid'],
  };

  const doctorUser: AuthContext = {
    userId: 'user-uuid-2',
    profileId: 'profile-uuid-2',
    organizationId: 'org-uuid',
    activeBranchId: 'branch-uuid',
    roles: ['DOCTOR'],
    branchIds: ['branch-uuid'],
  };

  const outsiderUser: AuthContext = {
    userId: 'user-uuid-3',
    profileId: 'profile-uuid-3',
    organizationId: 'org-uuid',
    activeBranchId: 'other-branch',
    roles: ['DOCTOR'],
    branchIds: ['other-branch'],
  };

  const mockBranch = { id: 'branch-uuid' };

  const mockVisitRow = {
    id: 'visit-uuid',
    visit_type: 'VISIT',
    priority: 'NORMAL',
    status: 'SCHEDULED',
    scheduled_at: new Date(),
    notes: null,
    assigned_doctor: {
      id: 'doctor-uuid',
      specialty: 'Gynecology',
      user: { id: 'user-uuid', first_name: 'Ahmed', last_name: 'Ali' },
    },
    episode: {
      id: 'ep-uuid',
      journey: {
        patient: { id: 'patient-uuid', full_name: 'Fatima Hassan' },
      },
    },
  };

  it('returns paginated visits for OWNER', async () => {
    db.branch.findFirst.mockResolvedValue(mockBranch);
    db.$transaction.mockResolvedValue([[mockVisitRow], 1]);
    const result = await service.findAllForBranch(
      'branch-uuid',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'SCHEDULED' as any,
      { page: 1, limit: 20 },
      ownerUser,
    );
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  it('returns paginated visits for DOCTOR in branch', async () => {
    db.branch.findFirst.mockResolvedValue(mockBranch);
    db.$transaction.mockResolvedValue([[mockVisitRow], 1]);
    const result = await service.findAllForBranch(
      'branch-uuid',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'SCHEDULED' as any,
      {},
      doctorUser,
    );
    expect(result.data).toHaveLength(1);
  });

  it('throws ForbiddenException when caller is not in branch and not OWNER', async () => {
    db.branch.findFirst.mockResolvedValue(mockBranch);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service.findAllForBranch('branch-uuid', 'SCHEDULED' as any, {}, outsiderUser),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when branch does not belong to org', async () => {
    db.branch.findFirst.mockResolvedValue(null);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service.findAllForBranch('branch-uuid', 'SCHEDULED' as any, {}, ownerUser),
    ).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail before implementation**

```bash
npx jest src/modules/visits/visits.service.spec.ts --testNamePattern="findAllForBranch" --no-coverage
```

Expected: FAIL — `findAllForBranch is not a function`.

- [ ] **Step 4: Run all visit tests after Task 4 is complete**

```bash
npx jest src/modules/visits/visits.service.spec.ts --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 5: Commit tests**

```bash
git add src/modules/visits/visits.service.spec.ts
git commit -m "test(visits): unit tests for findAllForBranch"
```

---

## Task 7: Full test run and lint

- [ ] **Step 1: Run full test suite**

```bash
npm run test
```

Expected: all tests pass, no regressions.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit if any lint fixes were applied**

```bash
git add -A
git commit -m "chore: fix lint issues"
```

---

## Verification

1. Start dev server: `npm run start:dev`
2. Authenticate → get access token.
3. **Doctor filter:** `GET /v1/organizations/<orgId>/staff?role=DOCTOR` — response should only include profiles with DOCTOR role.
4. **Branch + role filter:** `GET /v1/organizations/<orgId>/staff?branch_id=<branchId>&role=DOCTOR` — only DOCTOR profiles in that branch.
5. **Waiting list:** `GET /v1/branches/<branchId>/visits?status=SCHEDULED` — paginated SCHEDULED visits with doctor + patient names.
6. **In progress:** `GET /v1/branches/<branchId>/visits?status=IN_PROGRESS` — paginated IN_PROGRESS visits.
7. **Unauthorized caller:** profile not in branch, non-OWNER → expect 403.
8. **Invalid status:** `?status=INVALID` → expect 400 validation error.
9. **Unknown branch:** non-existent branchId → expect 404.
