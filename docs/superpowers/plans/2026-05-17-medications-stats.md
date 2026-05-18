# Medications List Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich `GET /medications` list response with per-medication prescription counts, top-5 prescribers, and linked medical reps.

**Architecture:** After the existing paginated medication query, two batch Prisma queries (keyed on the page's medication IDs) collect prescription stats and rep links. TypeScript aggregation merges them into an enriched DTO returned from `findAll()`. No schema changes.

**Tech Stack:** NestJS, Prisma ORM, Jest (unit tests), TypeScript

---

## File Map

| Action | File |
|--------|------|
| Modify | `src/core/clinical/medications/dto/medication.dto.ts` |
| Modify | `src/core/clinical/medications/medications.service.ts` |
| Modify | `src/core/clinical/medications/medications.controller.ts` |
| Modify | `src/core/clinical/medications/medications.service.spec.ts` |

---

### Task 1: Add stats DTOs

**Files:**
- Modify: `src/core/clinical/medications/dto/medication.dto.ts`

- [ ] **Step 1: Add the three new DTO classes to the file**

Replace the entire file with:

```typescript
export class MedicationDto {
  id!: string;
  organization_id!: string | null;
  code!: string;
  name!: string;
  generic_name!: string | null;
  form!: string | null;
  strength!: string | null;
  added_by_id!: string | null;
  is_deleted!: boolean;
  created_at!: Date;
  updated_at!: Date;
}

export class MedicationPrescriberDto {
  profile_id!: string;
  full_name!: string;
  count!: number;
}

export class MedicalRepLinkDto {
  id!: string;
  full_name!: string;
  company_name!: string;
}

export class MedicationWithStatsDto extends MedicationDto {
  total_prescriptions!: number;
  top_prescribers!: MedicationPrescriberDto[];
  medical_reps!: MedicalRepLinkDto[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/clinical/medications/dto/medication.dto.ts
git commit -m "feat(medications): add MedicationWithStatsDto, MedicationPrescriberDto, MedicalRepLinkDto"
```

---

### Task 2: Write failing tests for stats enrichment in findAll

**Files:**
- Modify: `src/core/clinical/medications/medications.service.spec.ts`

- [ ] **Step 1: Extend the mock `db` object to include prescriptionItem and medicalRepMedication**

In `medications.service.spec.ts`, replace the `db` variable declaration and `beforeEach` setup with:

```typescript
let db: {
  medication: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
  prescriptionItem: { findMany: jest.Mock };
  medicalRepMedication: { findMany: jest.Mock };
  medicalRep: { findFirst: jest.Mock };
  $transaction: jest.Mock;
};
```

Replace the `beforeEach` body with:

```typescript
beforeEach(async () => {
  db = {
    medication: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    prescriptionItem: { findMany: jest.fn().mockResolvedValue([]) },
    medicalRepMedication: { findMany: jest.fn().mockResolvedValue([]) },
    medicalRep: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn().mockImplementation((arr: Promise<unknown>[]) =>
      Promise.all(arr),
    ),
  };
  auth = {
    isOwner: jest.fn().mockResolvedValue(true),
    assertOwnerOnly: jest.fn(),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MedicationsService,
      { provide: PrismaService, useValue: { db } },
      { provide: AuthorizationService, useValue: auth },
    ],
  }).compile();
  service = module.get<MedicationsService>(MedicationsService);
});
```

- [ ] **Step 2: Add the failing `findAll` describe block**

Add this block after the existing `describe('update', ...)` block:

```typescript
describe('findAll stats enrichment', () => {
  const med1 = {
    id: 'med-1',
    organization_id: callerOrg,
    code: 'MED1',
    name: 'Drug A',
    generic_name: null,
    form: null,
    strength: null,
    added_by_id: 'profile-A',
    is_deleted: false,
    created_at: new Date(),
    updated_at: new Date(),
  };

  it('returns total_prescriptions: 0 and empty arrays when no data', async () => {
    db.medication.findMany.mockResolvedValue([med1]);
    db.medication.count.mockResolvedValue(1);
    db.$transaction.mockResolvedValue([[med1], 1]);
    db.prescriptionItem.findMany.mockResolvedValue([]);
    db.medicalRepMedication.findMany.mockResolvedValue([]);

    const result = await service.findAll({}, mockUser);
    const item = result.data[0] as any;

    expect(item.total_prescriptions).toBe(0);
    expect(item.top_prescribers).toEqual([]);
    expect(item.medical_reps).toEqual([]);
  });

  it('counts prescription items per prescriber and sums total', async () => {
    db.$transaction.mockResolvedValue([[med1], 1]);
    db.prescriptionItem.findMany.mockResolvedValue([
      {
        medication_id: 'med-1',
        prescription: {
          prescribed_by_id: 'doc-1',
          prescribed_by: { user: { first_name: 'Alice', last_name: 'Smith' } },
        },
      },
      {
        medication_id: 'med-1',
        prescription: {
          prescribed_by_id: 'doc-1',
          prescribed_by: { user: { first_name: 'Alice', last_name: 'Smith' } },
        },
      },
      {
        medication_id: 'med-1',
        prescription: {
          prescribed_by_id: 'doc-2',
          prescribed_by: { user: { first_name: 'Bob', last_name: 'Jones' } },
        },
      },
    ]);
    db.medicalRepMedication.findMany.mockResolvedValue([]);

    const result = await service.findAll({}, mockUser);
    const item = result.data[0] as any;

    expect(item.total_prescriptions).toBe(3);
    expect(item.top_prescribers).toHaveLength(2);
    expect(item.top_prescribers[0]).toEqual({
      profile_id: 'doc-1',
      full_name: 'Alice Smith',
      count: 2,
    });
    expect(item.top_prescribers[1]).toEqual({
      profile_id: 'doc-2',
      full_name: 'Bob Jones',
      count: 1,
    });
  });

  it('caps top_prescribers at 5 sorted by count descending', async () => {
    db.$transaction.mockResolvedValue([[med1], 1]);
    // 6 distinct prescribers, counts 6 down to 1
    db.prescriptionItem.findMany.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        medication_id: 'med-1',
        prescription: {
          prescribed_by_id: `doc-${i}`,
          prescribed_by: {
            user: { first_name: `Doc${i}`, last_name: 'Test' },
          },
        },
      })).flatMap((item, i) => Array(6 - i).fill(item)),
    );
    db.medicalRepMedication.findMany.mockResolvedValue([]);

    const result = await service.findAll({}, mockUser);
    const item = result.data[0] as any;

    expect(item.top_prescribers).toHaveLength(5);
    expect(item.top_prescribers[0].count).toBeGreaterThanOrEqual(
      item.top_prescribers[1].count,
    );
  });

  it('attaches medical_reps from MedicalRepMedication', async () => {
    db.$transaction.mockResolvedValue([[med1], 1]);
    db.prescriptionItem.findMany.mockResolvedValue([]);
    db.medicalRepMedication.findMany.mockResolvedValue([
      {
        medication_id: 'med-1',
        medical_rep: { id: 'rep-1', full_name: 'Rep One', company_name: 'Pharma A' },
      },
      {
        medication_id: 'med-1',
        medical_rep: { id: 'rep-2', full_name: 'Rep Two', company_name: 'Pharma B' },
      },
    ]);

    const result = await service.findAll({}, mockUser);
    const item = result.data[0] as any;

    expect(item.medical_reps).toHaveLength(2);
    expect(item.medical_reps[0]).toEqual({
      id: 'rep-1',
      full_name: 'Rep One',
      company_name: 'Pharma A',
    });
  });

  it('returns empty page without making stats queries when no medications found', async () => {
    db.$transaction.mockResolvedValue([[], 0]);

    const result = await service.findAll({}, mockUser);

    expect(result.data).toEqual([]);
    expect(db.prescriptionItem.findMany).not.toHaveBeenCalled();
    expect(db.medicalRepMedication.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the new tests to confirm they fail**

```bash
npx jest src/core/clinical/medications/medications.service.spec.ts --testNamePattern="findAll stats" -t "findAll stats" --no-coverage
```

Expected: all 5 tests in `findAll stats enrichment` fail (service doesn't return stats fields yet).

---

### Task 3: Implement gatherStats and enrich findAll

**Files:**
- Modify: `src/core/clinical/medications/medications.service.ts`

- [ ] **Step 1: Add the import for the new DTOs**

At the top of the file, add to the existing import from `'./dto/medication.dto'` (or add a new import):

```typescript
import { MedicationPrescriberDto, MedicalRepLinkDto } from './dto/medication.dto';
```

Note: `medication.dto.ts` already exports these after Task 1.

- [ ] **Step 2: Add the private gatherStats method to MedicationsService**

Add this private method inside the `MedicationsService` class, before the `assertReferenceable` method:

```typescript
private async gatherStats(
  medicationIds: string[],
  organizationId: string,
): Promise<
  Map<
    string,
    {
      total_prescriptions: number;
      top_prescribers: MedicationPrescriberDto[];
      medical_reps: MedicalRepLinkDto[];
    }
  >
> {
  const [prescriptionItems, repLinks] = await Promise.all([
    this.prismaService.db.prescriptionItem.findMany({
      where: {
        medication_id: { in: medicationIds },
        is_deleted: false,
        prescription: {
          is_deleted: false,
          prescribed_by: { organization_id: organizationId },
        },
      },
      select: {
        medication_id: true,
        prescription: {
          select: {
            prescribed_by_id: true,
            prescribed_by: {
              select: {
                user: { select: { first_name: true, last_name: true } },
              },
            },
          },
        },
      },
    }),
    this.prismaService.db.medicalRepMedication.findMany({
      where: { medication_id: { in: medicationIds } },
      select: {
        medication_id: true,
        medical_rep: {
          select: { id: true, full_name: true, company_name: true },
        },
      },
    }),
  ]);

  // Aggregate prescription counts per (medication, prescriber)
  const prescribersByMed = new Map<
    string,
    Map<string, MedicationPrescriberDto>
  >();
  const totalByMed = new Map<string, number>();

  for (const item of prescriptionItems) {
    const medId = item.medication_id!;
    const profileId = item.prescription.prescribed_by_id;
    const { first_name, last_name } = item.prescription.prescribed_by.user;

    totalByMed.set(medId, (totalByMed.get(medId) ?? 0) + 1);

    if (!prescribersByMed.has(medId)) prescribersByMed.set(medId, new Map());
    const pm = prescribersByMed.get(medId)!;
    if (!pm.has(profileId)) {
      pm.set(profileId, {
        profile_id: profileId,
        full_name: `${first_name} ${last_name}`,
        count: 0,
      });
    }
    pm.get(profileId)!.count++;
  }

  // Group rep links by medication_id
  const repsByMed = new Map<string, MedicalRepLinkDto[]>();
  for (const link of repLinks) {
    if (!repsByMed.has(link.medication_id)) repsByMed.set(link.medication_id, []);
    repsByMed.get(link.medication_id)!.push(link.medical_rep);
  }

  // Build per-medication stats
  const result = new Map<
    string,
    {
      total_prescriptions: number;
      top_prescribers: MedicationPrescriberDto[];
      medical_reps: MedicalRepLinkDto[];
    }
  >();

  for (const medId of medicationIds) {
    const prescriberMap = prescribersByMed.get(medId);
    const top_prescribers = prescriberMap
      ? [...prescriberMap.values()]
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
      : [];

    result.set(medId, {
      total_prescriptions: totalByMed.get(medId) ?? 0,
      top_prescribers,
      medical_reps: repsByMed.get(medId) ?? [],
    });
  }

  return result;
}
```

- [ ] **Step 3: Update findAll to call gatherStats and return enriched items**

Replace the end of the `findAll` method. The current last two lines are:

```typescript
    return paginated(items, { page, limit, total });
  }
```

Replace them with:

```typescript
    if (items.length === 0) return paginated([], { page, limit, total });

    const medicationIds = items.map((m) => m.id);
    const stats = await this.gatherStats(medicationIds, user.organizationId);

    const enriched = items.map((m) => ({
      ...m,
      total_prescriptions: stats.get(m.id)?.total_prescriptions ?? 0,
      top_prescribers: stats.get(m.id)?.top_prescribers ?? [],
      medical_reps: stats.get(m.id)?.medical_reps ?? [],
    }));

    return paginated(enriched, { page, limit, total });
  }
```

- [ ] **Step 4: Run the new tests to confirm they pass**

```bash
npx jest src/core/clinical/medications/medications.service.spec.ts --no-coverage
```

Expected: all tests pass (both existing and new `findAll stats enrichment` tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/clinical/medications/medications.service.ts src/core/clinical/medications/medications.service.spec.ts
git commit -m "feat(medications): enrich findAll with prescription stats and medical rep links"
```

---

### Task 4: Update controller Swagger decorator

**Files:**
- Modify: `src/core/clinical/medications/medications.controller.ts`

- [ ] **Step 1: Import MedicationWithStatsDto and update the decorator**

In `medications.controller.ts`, update the import from `'./dto/medication.dto'`:

```typescript
import { MedicationDto, MedicationWithStatsDto } from './dto/medication.dto';
```

Then on the `findAll` method, change:

```typescript
  @Get()
  @ApiPaginatedResponse(MedicationDto)
  findAll(
```

to:

```typescript
  @Get()
  @ApiPaginatedResponse(MedicationWithStatsDto)
  findAll(
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/clinical/medications/medications.controller.ts
git commit -m "feat(medications): update Swagger response type to MedicationWithStatsDto"
```

---

### Task 5: End-to-end verification

- [ ] **Step 1: Start the dev server**

```bash
npm run start:dev
```

Expected: server starts without TypeScript or runtime errors.

- [ ] **Step 2: Call GET /v1/medications with a valid bearer token**

```bash
curl -s -H "Authorization: Bearer <token>" http://localhost:3000/v1/medications | jq '.data[0]'
```

Expected response shape:
```json
{
  "id": "...",
  "code": "...",
  "name": "...",
  "total_prescriptions": 0,
  "top_prescribers": [],
  "medical_reps": []
}
```

- [ ] **Step 3: Verify a medication with known prescriptions shows correct count**

If the dev/seed database has prescriptions, pick a medication that was prescribed and confirm `total_prescriptions > 0` and `top_prescribers` is non-empty.

- [ ] **Step 4: Run the full test suite**

```bash
npm run test
```

Expected: all tests pass.
