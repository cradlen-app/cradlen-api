# Visits Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the patient registration + Journey → Episode → Visit foundation for Cradlen's journey-based MMR, including global patient records, specialty-grouped journey templates, and visit lifecycle management.

**Architecture:** Global `Patient` records (keyed by `national_id`) sit outside org scope; org-scoped `PatientJourney` links a patient to a templated journey at an org, auto-creating all `PatientEpisode` rows atomically on open; `Visit` is the leaf node recording individual appointments. DB-seeded `Specialty → JourneyTemplate → EpisodeTemplate` tables drive template expansion without code changes.

**Tech Stack:** NestJS v11, Prisma v7, PostgreSQL (Neon), Jest for unit tests.

---

## File Map

### New files
- `prisma/schema.prisma` — 6 new enums, 7 new models, back-relations on 3 existing models
- `prisma/seed.ts` — add Specialty GYN + 4 journey templates + episodes
- `src/modules/specialties/specialties.module.ts`
- `src/modules/specialties/specialties.controller.ts`
- `src/modules/specialties/specialties.service.ts`
- `src/modules/specialties/specialties.service.spec.ts`
- `src/modules/specialties/dto/specialty.dto.ts`
- `src/modules/journey-templates/journey-templates.module.ts`
- `src/modules/journey-templates/journey-templates.controller.ts`
- `src/modules/journey-templates/journey-templates.service.ts`
- `src/modules/journey-templates/journey-templates.service.spec.ts`
- `src/modules/journey-templates/dto/journey-template.dto.ts`
- `src/modules/patients/patients.module.ts`
- `src/modules/patients/patients.controller.ts`
- `src/modules/patients/patients.service.ts`
- `src/modules/patients/patients.service.spec.ts`
- `src/modules/patients/dto/create-patient.dto.ts`
- `src/modules/patients/dto/update-patient.dto.ts`
- `src/modules/patients/dto/list-patients-query.dto.ts`
- `src/modules/patients/dto/patient.dto.ts`
- `src/modules/journeys/journeys.module.ts`
- `src/modules/journeys/journeys.controller.ts`
- `src/modules/journeys/journeys.service.ts`
- `src/modules/journeys/journeys.service.spec.ts`
- `src/modules/journeys/dto/create-journey.dto.ts`
- `src/modules/journeys/dto/update-journey-status.dto.ts`
- `src/modules/journeys/dto/update-episode-status.dto.ts`
- `src/modules/journeys/dto/journey.dto.ts`
- `src/modules/visits/visits.module.ts`
- `src/modules/visits/visits.controller.ts`
- `src/modules/visits/visits.service.ts`
- `src/modules/visits/visits.service.spec.ts`
- `src/modules/visits/dto/create-visit.dto.ts`
- `src/modules/visits/dto/update-visit.dto.ts`
- `src/modules/visits/dto/update-visit-status.dto.ts`
- `src/modules/visits/dto/visit.dto.ts`

### Modified files
- `src/app.module.ts` — import 5 new modules

---

## Task 1: Prisma Schema — Enums, Models, Back-relations, Migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enums to the end of the enums block in `prisma/schema.prisma`**

Add these after the existing enums:

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

- [ ] **Step 2: Add back-relations to existing models**

In the `Organization` model, add inside the model body after `subscriptions Subscription[]`:
```prisma
  patient_journeys PatientJourney[]
```

In the `Branch` model, add inside the model body after `workingSchedules WorkingSchedule[]`:
```prisma
  visits Visit[]
```

In the `Profile` model, add inside the model body after `workingSchedules WorkingSchedule[]`:
```prisma
  created_journeys PatientJourney[]
  doctor_visits    Visit[]         @relation("DoctorVisits")
  created_visits   Visit[]         @relation("CreatedVisits")
```

- [ ] **Step 3: Add 7 new models at the end of `prisma/schema.prisma`**

```prisma
model Specialty {
  id          String            @id @default(uuid()) @db.Uuid
  name        String            @unique
  code        String            @unique
  description String?
  templates   JourneyTemplate[]
  created_at  DateTime          @default(now())
  updated_at  DateTime          @updatedAt

  @@map("specialties")
}

model JourneyTemplate {
  id           String              @id @default(uuid()) @db.Uuid
  specialty_id String              @db.Uuid
  specialty    Specialty           @relation(fields: [specialty_id], references: [id])
  name         String              @unique
  type         JourneyTemplateType
  description  String?
  episodes     EpisodeTemplate[]
  journeys     PatientJourney[]
  created_at   DateTime            @default(now())
  updated_at   DateTime            @updatedAt

  @@index([specialty_id])
  @@map("journey_templates")
}

model EpisodeTemplate {
  id                  String          @id @default(uuid()) @db.Uuid
  journey_template_id String          @db.Uuid
  journey_template    JourneyTemplate @relation(fields: [journey_template_id], references: [id])
  name                String
  order               Int
  episodes            PatientEpisode[]
  created_at          DateTime        @default(now())
  updated_at          DateTime        @updatedAt

  @@index([journey_template_id])
  @@map("episode_templates")
}

model Patient {
  id            String           @id @default(uuid()) @db.Uuid
  national_id   String           @unique
  full_name     String
  husband_name  String?
  date_of_birth DateTime         @db.Date
  phone_number  String
  address       String
  journeys      PatientJourney[]
  created_at    DateTime         @default(now())
  updated_at    DateTime         @updatedAt
  is_deleted    Boolean          @default(false)
  deleted_at    DateTime?

  @@index([national_id])
  @@map("patients")
}

model PatientJourney {
  id                  String          @id @default(uuid()) @db.Uuid
  patient_id          String          @db.Uuid
  patient             Patient         @relation(fields: [patient_id], references: [id])
  organization_id     String          @db.Uuid
  organization        Organization    @relation(fields: [organization_id], references: [id])
  journey_template_id String          @db.Uuid
  journey_template    JourneyTemplate @relation(fields: [journey_template_id], references: [id])
  created_by_id       String          @db.Uuid
  created_by          Profile         @relation(fields: [created_by_id], references: [id])
  status              JourneyStatus   @default(ACTIVE)
  started_at          DateTime        @default(now())
  ended_at            DateTime?
  episodes            PatientEpisode[]
  created_at          DateTime        @default(now())
  updated_at          DateTime        @updatedAt
  is_deleted          Boolean         @default(false)
  deleted_at          DateTime?

  @@index([patient_id, organization_id, is_deleted])
  @@index([organization_id, status, is_deleted])
  @@map("patient_journeys")
}

model PatientEpisode {
  id                  String          @id @default(uuid()) @db.Uuid
  journey_id          String          @db.Uuid
  journey             PatientJourney  @relation(fields: [journey_id], references: [id])
  episode_template_id String          @db.Uuid
  episode_template    EpisodeTemplate @relation(fields: [episode_template_id], references: [id])
  name                String
  order               Int
  status              EpisodeStatus   @default(PENDING)
  started_at          DateTime?
  ended_at            DateTime?
  visits              Visit[]
  created_at          DateTime        @default(now())
  updated_at          DateTime        @updatedAt
  is_deleted          Boolean         @default(false)
  deleted_at          DateTime?

  @@index([journey_id, is_deleted])
  @@map("patient_episodes")
}

model Visit {
  id                 String         @id @default(uuid()) @db.Uuid
  episode_id         String         @db.Uuid
  episode            PatientEpisode @relation(fields: [episode_id], references: [id])
  assigned_doctor_id String         @db.Uuid
  assigned_doctor    Profile        @relation("DoctorVisits", fields: [assigned_doctor_id], references: [id])
  branch_id          String         @db.Uuid
  branch             Branch         @relation(fields: [branch_id], references: [id])
  created_by_id      String         @db.Uuid
  created_by         Profile        @relation("CreatedVisits", fields: [created_by_id], references: [id])
  visit_type         VisitType
  priority           VisitPriority
  status             VisitStatus    @default(SCHEDULED)
  scheduled_at       DateTime
  checked_in_at      DateTime?
  started_at         DateTime?
  completed_at       DateTime?
  notes              String?
  created_at         DateTime       @default(now())
  updated_at         DateTime       @updatedAt
  is_deleted         Boolean        @default(false)
  deleted_at         DateTime?

  @@index([episode_id, is_deleted])
  @@index([assigned_doctor_id, is_deleted])
  @@map("visits")
}
```

- [ ] **Step 4: Run migration**

```bash
npx prisma migrate dev --name visits-foundation
```

Expected: migration file created and applied, no errors.

- [ ] **Step 5: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: `@prisma/client` updated with new types.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add visits foundation models — Patient, Journey, Episode, Visit, Specialty, templates"
```

---

## Task 2: Seed Data — Specialty GYN + Journey Templates

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Add specialty and template seeding to `prisma/seed.ts`**

Add after the existing subscription plan upserts, before `console.log('Seed complete.')`:

```typescript
  // Specialty: GYN
  const gynSpecialty = await prisma.specialty.upsert({
    where: { code: 'GYN' },
    update: {},
    create: { name: 'Gynecology', code: 'GYN', description: 'Obstetrics and Gynecology' },
  });

  // Journey Templates
  const pregnancyTemplate = await prisma.journeyTemplate.upsert({
    where: { name: 'Pregnancy Journey' },
    update: {},
    create: {
      specialty_id: gynSpecialty.id,
      name: 'Pregnancy Journey',
      type: 'PREGNANCY',
      description: 'Full antenatal and postnatal pregnancy pathway',
    },
  });

  const generalGynTemplate = await prisma.journeyTemplate.upsert({
    where: { name: 'General GYN Journey' },
    update: {},
    create: {
      specialty_id: gynSpecialty.id,
      name: 'General GYN Journey',
      type: 'GENERAL_GYN',
      description: 'General gynecology consultations and follow-ups',
    },
  });

  const surgicalTemplate = await prisma.journeyTemplate.upsert({
    where: { name: 'Surgical Journey' },
    update: {},
    create: {
      specialty_id: gynSpecialty.id,
      name: 'Surgical Journey',
      type: 'SURGICAL',
      description: 'Pre-operative, surgical, and post-operative care',
    },
  });

  const chronicTemplate = await prisma.journeyTemplate.upsert({
    where: { name: 'Chronic Condition Journey' },
    update: {},
    create: {
      specialty_id: gynSpecialty.id,
      name: 'Chronic Condition Journey',
      type: 'CHRONIC_CONDITION',
      description: 'Long-term management of chronic gynecological conditions',
    },
  });

  // Episode Templates — upsert by template + order pair
  const pregnancyEpisodes = [
    { name: 'First Trimester', order: 1 },
    { name: 'Second Trimester', order: 2 },
    { name: 'Third Trimester', order: 3 },
    { name: 'Delivery', order: 4 },
    { name: 'Postpartum', order: 5 },
  ];
  for (const ep of pregnancyEpisodes) {
    const existing = await prisma.episodeTemplate.findFirst({
      where: { journey_template_id: pregnancyTemplate.id, order: ep.order },
    });
    if (!existing) {
      await prisma.episodeTemplate.create({
        data: { journey_template_id: pregnancyTemplate.id, ...ep },
      });
    }
  }

  const generalGynEpisodes = [{ name: 'General Consultation', order: 1 }];
  for (const ep of generalGynEpisodes) {
    const existing = await prisma.episodeTemplate.findFirst({
      where: { journey_template_id: generalGynTemplate.id, order: ep.order },
    });
    if (!existing) {
      await prisma.episodeTemplate.create({
        data: { journey_template_id: generalGynTemplate.id, ...ep },
      });
    }
  }

  const surgicalEpisodes = [
    { name: 'Pre-operative', order: 1 },
    { name: 'Surgery', order: 2 },
    { name: 'Post-operative', order: 3 },
  ];
  for (const ep of surgicalEpisodes) {
    const existing = await prisma.episodeTemplate.findFirst({
      where: { journey_template_id: surgicalTemplate.id, order: ep.order },
    });
    if (!existing) {
      await prisma.episodeTemplate.create({
        data: { journey_template_id: surgicalTemplate.id, ...ep },
      });
    }
  }

  const chronicEpisodes = [
    { name: 'Diagnosis & Stabilization', order: 1 },
    { name: 'Ongoing Management', order: 2 },
  ];
  for (const ep of chronicEpisodes) {
    const existing = await prisma.episodeTemplate.findFirst({
      where: { journey_template_id: chronicTemplate.id, order: ep.order },
    });
    if (!existing) {
      await prisma.episodeTemplate.create({
        data: { journey_template_id: chronicTemplate.id, ...ep },
      });
    }
  }
```

- [ ] **Step 2: Run seed**

```bash
npx prisma db seed
```

Expected output ends with `Seed complete.` and no errors.

- [ ] **Step 3: Verify in DB**

```bash
npx prisma studio
```

Check `specialties` table has 1 row (GYN), `journey_templates` has 4 rows, `episode_templates` has 11 rows total.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(seed): add GYN specialty, 4 journey templates, and 11 episode templates"
```

---

## Task 3: Specialties Module

**Files:**
- Create: `src/modules/specialties/dto/specialty.dto.ts`
- Create: `src/modules/specialties/specialties.service.ts`
- Create: `src/modules/specialties/specialties.service.spec.ts`
- Create: `src/modules/specialties/specialties.controller.ts`
- Create: `src/modules/specialties/specialties.module.ts`

- [ ] **Step 1: Create DTO**

`src/modules/specialties/dto/specialty.dto.ts`:
```typescript
export class EpisodeTemplateDto {
  id: string;
  name: string;
  order: number;
}

export class JourneyTemplateInSpecialtyDto {
  id: string;
  name: string;
  type: string;
  description: string | null;
  episodes: EpisodeTemplateDto[];
}

export class SpecialtyDto {
  id: string;
  name: string;
  code: string;
  description: string | null;
  templates: JourneyTemplateInSpecialtyDto[];
}
```

- [ ] **Step 2: Write failing test**

`src/modules/specialties/specialties.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SpecialtiesService } from './specialties.service';
import { PrismaService } from '../../database/prisma.service';

const mockSpecialty = {
  id: 'spec-uuid',
  name: 'Gynecology',
  code: 'GYN',
  description: null,
  templates: [
    {
      id: 'tmpl-uuid',
      name: 'Pregnancy Journey',
      type: 'PREGNANCY',
      description: null,
      episodes: [{ id: 'ep-uuid', name: 'First Trimester', order: 1 }],
    },
  ],
};

describe('SpecialtiesService', () => {
  let service: SpecialtiesService;
  let db: any;

  beforeEach(async () => {
    db = {
      specialty: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      journeyTemplate: { findMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpecialtiesService,
        { provide: PrismaService, useValue: { db } },
      ],
    }).compile();
    service = module.get<SpecialtiesService>(SpecialtiesService);
  });

  describe('findAll', () => {
    it('returns all specialties with templates and episodes', async () => {
      db.specialty.findMany.mockResolvedValue([mockSpecialty]);
      const result = await service.findAll();
      expect(result).toEqual([mockSpecialty]);
      expect(db.specialty.findMany).toHaveBeenCalledWith({
        include: {
          templates: {
            include: { episodes: { orderBy: { order: 'asc' } } },
          },
        },
      });
    });
  });

  describe('findJourneyTemplates', () => {
    it('returns journey templates for a specialty', async () => {
      db.specialty.findUnique.mockResolvedValue(mockSpecialty);
      db.journeyTemplate.findMany.mockResolvedValue(mockSpecialty.templates);
      const result = await service.findJourneyTemplates('spec-uuid');
      expect(result).toEqual(mockSpecialty.templates);
    });

    it('throws NotFoundException when specialty not found', async () => {
      db.specialty.findUnique.mockResolvedValue(null);
      await expect(service.findJourneyTemplates('bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx jest src/modules/specialties/specialties.service.spec.ts --no-coverage
```

Expected: FAIL — `SpecialtiesService` not found.

- [ ] **Step 4: Implement service**

`src/modules/specialties/specialties.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SpecialtiesService {
  constructor(private readonly prismaService: PrismaService) {}

  findAll() {
    return this.prismaService.db.specialty.findMany({
      include: {
        templates: {
          include: { episodes: { orderBy: { order: 'asc' } } },
        },
      },
    });
  }

  async findJourneyTemplates(id: string) {
    const specialty = await this.prismaService.db.specialty.findUnique({
      where: { id },
    });
    if (!specialty) throw new NotFoundException(`Specialty ${id} not found`);
    return this.prismaService.db.journeyTemplate.findMany({
      where: { specialty_id: id },
      include: { episodes: { orderBy: { order: 'asc' } } },
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest src/modules/specialties/specialties.service.spec.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 6: Implement controller and module**

`src/modules/specialties/specialties.controller.ts`:
```typescript
import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SpecialtiesService } from './specialties.service';
import { ApiStandardResponse, ApiPaginatedResponse } from '../../common/swagger';
import { SpecialtyDto, JourneyTemplateInSpecialtyDto } from './dto/specialty.dto';

@ApiTags('Specialties')
@Controller('specialties')
export class SpecialtiesController {
  constructor(private readonly specialtiesService: SpecialtiesService) {}

  @Get()
  @ApiPaginatedResponse(SpecialtyDto)
  findAll() {
    return this.specialtiesService.findAll();
  }

  @Get(':id/journey-templates')
  @ApiPaginatedResponse(JourneyTemplateInSpecialtyDto)
  findJourneyTemplates(@Param('id') id: string) {
    return this.specialtiesService.findJourneyTemplates(id);
  }
}
```

`src/modules/specialties/specialties.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { SpecialtiesController } from './specialties.controller';
import { SpecialtiesService } from './specialties.service';

@Module({
  controllers: [SpecialtiesController],
  providers: [SpecialtiesService],
})
export class SpecialtiesModule {}
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/specialties/
git commit -m "feat(specialties): add read-only specialties module with journey template listing"
```

---

## Task 4: Journey Templates Module

**Files:**
- Create: `src/modules/journey-templates/dto/journey-template.dto.ts`
- Create: `src/modules/journey-templates/journey-templates.service.ts`
- Create: `src/modules/journey-templates/journey-templates.service.spec.ts`
- Create: `src/modules/journey-templates/journey-templates.controller.ts`
- Create: `src/modules/journey-templates/journey-templates.module.ts`

- [ ] **Step 1: Create DTO**

`src/modules/journey-templates/dto/journey-template.dto.ts`:
```typescript
export class EpisodeTemplateDto {
  id: string;
  name: string;
  order: number;
}

export class JourneyTemplateDto {
  id: string;
  specialty_id: string;
  name: string;
  type: string;
  description: string | null;
  episodes: EpisodeTemplateDto[];
}
```

- [ ] **Step 2: Write failing test**

`src/modules/journey-templates/journey-templates.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { JourneyTemplatesService } from './journey-templates.service';
import { PrismaService } from '../../database/prisma.service';

const mockTemplate = {
  id: 'tmpl-uuid',
  specialty_id: 'spec-uuid',
  name: 'Pregnancy Journey',
  type: 'PREGNANCY',
  description: null,
  episodes: [{ id: 'ep-uuid', name: 'First Trimester', order: 1 }],
};

describe('JourneyTemplatesService', () => {
  let service: JourneyTemplatesService;
  let db: any;

  beforeEach(async () => {
    db = {
      journeyTemplate: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JourneyTemplatesService,
        { provide: PrismaService, useValue: { db } },
      ],
    }).compile();
    service = module.get<JourneyTemplatesService>(JourneyTemplatesService);
  });

  describe('findAll', () => {
    it('returns all templates when no filter given', async () => {
      db.journeyTemplate.findMany.mockResolvedValue([mockTemplate]);
      const result = await service.findAll(undefined);
      expect(result).toEqual([mockTemplate]);
      expect(db.journeyTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('filters by specialtyId when provided', async () => {
      db.journeyTemplate.findMany.mockResolvedValue([mockTemplate]);
      await service.findAll('spec-uuid');
      expect(db.journeyTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { specialty_id: 'spec-uuid' } }),
      );
    });
  });

  describe('findOne', () => {
    it('returns template when found', async () => {
      db.journeyTemplate.findUnique.mockResolvedValue(mockTemplate);
      const result = await service.findOne('tmpl-uuid');
      expect(result).toEqual(mockTemplate);
    });

    it('throws NotFoundException when not found', async () => {
      db.journeyTemplate.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx jest src/modules/journey-templates/journey-templates.service.spec.ts --no-coverage
```

Expected: FAIL.

- [ ] **Step 4: Implement service**

`src/modules/journey-templates/journey-templates.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class JourneyTemplatesService {
  constructor(private readonly prismaService: PrismaService) {}

  findAll(specialtyId: string | undefined) {
    return this.prismaService.db.journeyTemplate.findMany({
      where: specialtyId ? { specialty_id: specialtyId } : {},
      include: { episodes: { orderBy: { order: 'asc' } } },
    });
  }

  async findOne(id: string) {
    const template = await this.prismaService.db.journeyTemplate.findUnique({
      where: { id },
      include: { episodes: { orderBy: { order: 'asc' } } },
    });
    if (!template) throw new NotFoundException(`Journey template ${id} not found`);
    return template;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest src/modules/journey-templates/journey-templates.service.spec.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 6: Implement controller and module**

`src/modules/journey-templates/journey-templates.controller.ts`:
```typescript
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiQuery } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { JourneyTemplatesService } from './journey-templates.service';
import { ApiPaginatedResponse, ApiStandardResponse } from '../../common/swagger';
import { JourneyTemplateDto } from './dto/journey-template.dto';

class ListTemplatesQueryDto {
  @IsOptional() @IsUUID() specialtyId?: string;
}

@ApiTags('Journey Templates')
@Controller('journey-templates')
export class JourneyTemplatesController {
  constructor(private readonly service: JourneyTemplatesService) {}

  @Get()
  @ApiQuery({ name: 'specialtyId', required: false })
  @ApiPaginatedResponse(JourneyTemplateDto)
  findAll(@Query() query: ListTemplatesQueryDto) {
    return this.service.findAll(query.specialtyId);
  }

  @Get(':id')
  @ApiStandardResponse(JourneyTemplateDto)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
```

`src/modules/journey-templates/journey-templates.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { JourneyTemplatesController } from './journey-templates.controller';
import { JourneyTemplatesService } from './journey-templates.service';

@Module({
  controllers: [JourneyTemplatesController],
  providers: [JourneyTemplatesService],
})
export class JourneyTemplatesModule {}
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/journey-templates/
git commit -m "feat(journey-templates): add read-only journey templates module with specialty filter"
```

---

## Task 5: Patients Module

**Files:**
- Create: `src/modules/patients/dto/create-patient.dto.ts`
- Create: `src/modules/patients/dto/update-patient.dto.ts`
- Create: `src/modules/patients/dto/list-patients-query.dto.ts`
- Create: `src/modules/patients/dto/patient.dto.ts`
- Create: `src/modules/patients/patients.service.ts`
- Create: `src/modules/patients/patients.service.spec.ts`
- Create: `src/modules/patients/patients.controller.ts`
- Create: `src/modules/patients/patients.module.ts`

- [ ] **Step 1: Create DTOs**

`src/modules/patients/dto/create-patient.dto.ts`:
```typescript
import { IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';

export class CreatePatientDto {
  @IsString() @IsNotEmpty() full_name: string;
  @IsString() @IsOptional() husband_name?: string;
  @IsDateString() date_of_birth: string;
  @IsString() @IsNotEmpty() national_id: string;
  @IsString() @IsNotEmpty() phone_number: string;
  @IsString() @IsNotEmpty() address: string;
}
```

`src/modules/patients/dto/update-patient.dto.ts`:
```typescript
import { IsString, IsOptional, IsDateString } from 'class-validator';

export class UpdatePatientDto {
  @IsString() @IsOptional() full_name?: string;
  @IsString() @IsOptional() husband_name?: string;
  @IsDateString() @IsOptional() date_of_birth?: string;
  @IsString() @IsOptional() phone_number?: string;
  @IsString() @IsOptional() address?: string;
}
```

`src/modules/patients/dto/list-patients-query.dto.ts`:
```typescript
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ListPatientsQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}
```

`src/modules/patients/dto/patient.dto.ts`:
```typescript
export class PatientDto {
  id: string;
  national_id: string;
  full_name: string;
  husband_name: string | null;
  date_of_birth: Date;
  phone_number: string;
  address: string;
  created_at: Date;
}

export class EpisodeSummaryDto {
  id: string;
  name: string;
  order: number;
}

export class PatientLookupDto extends PatientDto {
  active_episodes: EpisodeSummaryDto[];
}
```

- [ ] **Step 2: Write failing tests**

`src/modules/patients/patients.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-uuid',
  organizationId: 'org-uuid',
  roles: ['RECEPTIONIST'],
  branchIds: ['branch-uuid'],
};

const mockPatient = {
  id: 'patient-uuid',
  national_id: '12345678',
  full_name: 'Sara Ali',
  husband_name: 'Ahmed Ali',
  date_of_birth: new Date('1990-01-01'),
  phone_number: '01012345678',
  address: 'Cairo',
  is_deleted: false,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('PatientsService', () => {
  let service: PatientsService;
  let db: any;

  beforeEach(async () => {
    db = {
      patient: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      patientJourney: { findFirst: jest.fn() },
      patientEpisode: { findMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientsService,
        { provide: PrismaService, useValue: { db } },
      ],
    }).compile();
    service = module.get<PatientsService>(PatientsService);
  });

  describe('create', () => {
    it('creates a patient when national_id is unique', async () => {
      db.patient.findUnique.mockResolvedValue(null);
      db.patient.create.mockResolvedValue(mockPatient);
      const result = await service.create({
        full_name: 'Sara Ali',
        husband_name: 'Ahmed Ali',
        date_of_birth: '1990-01-01',
        national_id: '12345678',
        phone_number: '01012345678',
        address: 'Cairo',
      });
      expect(result).toEqual(mockPatient);
      expect(db.patient.create).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when national_id already exists', async () => {
      db.patient.findUnique.mockResolvedValue(mockPatient);
      await expect(
        service.create({
          full_name: 'Sara Ali',
          husband_name: null,
          date_of_birth: '1990-01-01',
          national_id: '12345678',
          phone_number: '01012345678',
          address: 'Cairo',
        }),
      ).rejects.toThrow(ConflictException);
      expect(db.patient.create).not.toHaveBeenCalled();
    });
  });

  describe('lookup', () => {
    it('returns patient with episode summaries for non-clinical role', async () => {
      const mockActiveEpisodes = [{ id: 'ep-uuid', name: 'First Trimester', order: 1 }];
      db.patient.findUnique.mockResolvedValue(mockPatient);
      db.patientJourney.findFirst.mockResolvedValue({ id: 'journey-uuid' });
      db.patientEpisode.findMany.mockResolvedValue(mockActiveEpisodes);
      const result = await service.lookup('12345678', mockUser);
      expect(result).toMatchObject({ national_id: '12345678' });
      expect((result as any).active_episodes).toEqual(mockActiveEpisodes);
    });

    it('throws NotFoundException when patient not found', async () => {
      db.patient.findUnique.mockResolvedValue(null);
      await expect(service.lookup('99999999', mockUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('returns patient when found', async () => {
      db.patient.findUnique.mockResolvedValue(mockPatient);
      const result = await service.findOne('patient-uuid');
      expect(result).toEqual(mockPatient);
    });

    it('throws NotFoundException when not found', async () => {
      db.patient.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx jest src/modules/patients/patients.service.spec.ts --no-coverage
```

Expected: FAIL.

- [ ] **Step 4: Implement service**

`src/modules/patients/patients.service.ts`:
```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { ListPatientsQueryDto } from './dto/list-patients-query.dto';
import { paginated } from '../../common/utils/pagination.utils';

@Injectable()
export class PatientsService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(dto: CreatePatientDto) {
    const existing = await this.prismaService.db.patient.findUnique({
      where: { national_id: dto.national_id },
    });
    if (existing) {
      throw new ConflictException('A patient with this national ID already exists');
    }
    return this.prismaService.db.patient.create({
      data: {
        full_name: dto.full_name,
        husband_name: dto.husband_name ?? null,
        date_of_birth: new Date(dto.date_of_birth),
        national_id: dto.national_id,
        phone_number: dto.phone_number,
        address: dto.address,
      },
    });
  }

  async findAll(query: ListPatientsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      is_deleted: false,
      ...(query.search
        ? {
            OR: [
              { full_name: { contains: query.search, mode: 'insensitive' as const } },
              { national_id: { contains: query.search } },
              { phone_number: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [patients, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.patient.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prismaService.db.patient.count({ where }),
    ]);
    return paginated(patients, { page, limit, total });
  }

  async lookup(nationalId: string, user: AuthContext) {
    const patient = await this.prismaService.db.patient.findUnique({
      where: { national_id: nationalId, is_deleted: false },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const isClinicianRole =
      user.roles.includes('DOCTOR') || user.roles.includes('OWNER');

    const activeJourney = await this.prismaService.db.patientJourney.findFirst({
      where: {
        patient_id: patient.id,
        organization_id: user.organizationId,
        status: 'ACTIVE',
        is_deleted: false,
      },
    });

    if (isClinicianRole && activeJourney) {
      const episodes = await this.prismaService.db.patientEpisode.findMany({
        where: { journey_id: activeJourney.id, is_deleted: false },
        orderBy: { order: 'asc' },
      });
      return { ...patient, active_journey: { ...activeJourney, episodes } };
    }

    const activeEpisodes = activeJourney
      ? await this.prismaService.db.patientEpisode.findMany({
          where: { journey_id: activeJourney.id, is_deleted: false },
          select: { id: true, name: true, order: true },
          orderBy: { order: 'asc' },
        })
      : [];

    return { ...patient, active_episodes: activeEpisodes };
  }

  async findOne(id: string) {
    const patient = await this.prismaService.db.patient.findUnique({
      where: { id, is_deleted: false },
    });
    if (!patient) throw new NotFoundException(`Patient ${id} not found`);
    return patient;
  }

  async update(id: string, dto: UpdatePatientDto) {
    await this.findOne(id);
    return this.prismaService.db.patient.update({
      where: { id },
      data: {
        ...(dto.full_name !== undefined && { full_name: dto.full_name }),
        ...(dto.husband_name !== undefined && { husband_name: dto.husband_name }),
        ...(dto.date_of_birth !== undefined && { date_of_birth: new Date(dto.date_of_birth) }),
        ...(dto.phone_number !== undefined && { phone_number: dto.phone_number }),
        ...(dto.address !== undefined && { address: dto.address }),
      },
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest src/modules/patients/patients.service.spec.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 6: Implement controller and module**

`src/modules/patients/patients.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { ListPatientsQueryDto } from './dto/list-patients-query.dto';
import { PatientDto, PatientLookupDto } from './dto/patient.dto';
import {
  ApiStandardResponse,
  ApiPaginatedResponse,
} from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

@ApiTags('Patients')
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @ApiStandardResponse(PatientDto)
  create(@Body() dto: CreatePatientDto) {
    return this.patientsService.create(dto);
  }

  @Get()
  @ApiPaginatedResponse(PatientDto)
  findAll(@Query() query: ListPatientsQueryDto) {
    return this.patientsService.findAll(query);
  }

  @Get('lookup')
  @ApiStandardResponse(PatientLookupDto)
  lookup(
    @Query('nationalId') nationalId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.patientsService.lookup(nationalId, user);
  }

  @Get(':id')
  @ApiStandardResponse(PatientDto)
  findOne(@Param('id') id: string) {
    return this.patientsService.findOne(id);
  }

  @Patch(':id')
  @ApiStandardResponse(PatientDto)
  update(@Param('id') id: string, @Body() dto: UpdatePatientDto) {
    return this.patientsService.update(id, dto);
  }
}
```

`src/modules/patients/patients.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  controllers: [PatientsController],
  providers: [PatientsService],
})
export class PatientsModule {}
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/patients/
git commit -m "feat(patients): add global patient registration, lookup by national ID, and search"
```

---

## Task 6: Journeys Module

**Files:**
- Create: `src/modules/journeys/dto/create-journey.dto.ts`
- Create: `src/modules/journeys/dto/update-journey-status.dto.ts`
- Create: `src/modules/journeys/dto/update-episode-status.dto.ts`
- Create: `src/modules/journeys/dto/journey.dto.ts`
- Create: `src/modules/journeys/journeys.service.ts`
- Create: `src/modules/journeys/journeys.service.spec.ts`
- Create: `src/modules/journeys/journeys.controller.ts`
- Create: `src/modules/journeys/journeys.module.ts`

- [ ] **Step 1: Create DTOs**

`src/modules/journeys/dto/create-journey.dto.ts`:
```typescript
import { IsUUID } from 'class-validator';

export class CreateJourneyDto {
  @IsUUID() journey_template_id: string;
}
```

`src/modules/journeys/dto/update-journey-status.dto.ts`:
```typescript
import { IsEnum } from 'class-validator';
import { JourneyStatus } from '@prisma/client';

export class UpdateJourneyStatusDto {
  @IsEnum(['COMPLETED', 'CANCELLED']) status: Extract<JourneyStatus, 'COMPLETED' | 'CANCELLED'>;
}
```

`src/modules/journeys/dto/update-episode-status.dto.ts`:
```typescript
import { IsEnum } from 'class-validator';
import { EpisodeStatus } from '@prisma/client';

export class UpdateEpisodeStatusDto {
  @IsEnum(['ACTIVE', 'COMPLETED']) status: Extract<EpisodeStatus, 'ACTIVE' | 'COMPLETED'>;
}
```

`src/modules/journeys/dto/journey.dto.ts`:
```typescript
export class EpisodeDto {
  id: string;
  name: string;
  order: number;
  status: string;
  started_at: Date | null;
  ended_at: Date | null;
}

export class JourneyDto {
  id: string;
  patient_id: string;
  organization_id: string;
  journey_template_id: string;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  episodes: EpisodeDto[];
}
```

- [ ] **Step 2: Write failing tests**

`src/modules/journeys/journeys.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JourneysService } from './journeys.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-uuid',
  organizationId: 'org-uuid',
  roles: ['DOCTOR'],
  branchIds: ['branch-uuid'],
};

const mockTemplate = {
  id: 'tmpl-uuid',
  name: 'Pregnancy Journey',
  type: 'PREGNANCY',
  episodes: [
    { id: 'ept-1', name: 'First Trimester', order: 1 },
    { id: 'ept-2', name: 'Second Trimester', order: 2 },
  ],
};

const mockJourney = {
  id: 'journey-uuid',
  patient_id: 'patient-uuid',
  organization_id: 'org-uuid',
  journey_template_id: 'tmpl-uuid',
  status: 'ACTIVE',
  started_at: new Date(),
  ended_at: null,
  episodes: [],
};

describe('JourneysService', () => {
  let service: JourneysService;
  let db: any;
  let prismaMock: any;

  beforeEach(async () => {
    db = {
      patient: { findUnique: jest.fn() },
      patientJourney: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      patientEpisode: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      journeyTemplate: { findUnique: jest.fn() },
    };
    prismaMock = {
      db,
      $transaction: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JourneysService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<JourneysService>(JourneysService);
  });

  describe('create', () => {
    it('throws NotFoundException when patient does not exist', async () => {
      db.patient.findUnique.mockResolvedValue(null);
      await expect(
        service.create('patient-uuid', { journey_template_id: 'tmpl-uuid' }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when active journey of same type exists', async () => {
      db.patient.findUnique.mockResolvedValue({ id: 'patient-uuid' });
      db.patientJourney.findFirst.mockResolvedValue(mockJourney);
      await expect(
        service.create('patient-uuid', { journey_template_id: 'tmpl-uuid' }, mockUser),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when template does not exist', async () => {
      db.patient.findUnique.mockResolvedValue({ id: 'patient-uuid' });
      db.patientJourney.findFirst.mockResolvedValue(null);
      db.journeyTemplate.findUnique.mockResolvedValue(null);
      await expect(
        service.create('patient-uuid', { journey_template_id: 'tmpl-uuid' }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates journey and auto-creates episodes in transaction', async () => {
      db.patient.findUnique.mockResolvedValue({ id: 'patient-uuid' });
      db.patientJourney.findFirst.mockResolvedValue(null);
      db.journeyTemplate.findUnique.mockResolvedValue(mockTemplate);
      prismaMock.$transaction.mockResolvedValue(mockJourney);
      const result = await service.create(
        'patient-uuid',
        { journey_template_id: 'tmpl-uuid' },
        mockUser,
      );
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockJourney);
    });
  });

  describe('findOne', () => {
    it('returns journey when found and org matches', async () => {
      db.patientJourney.findUnique.mockResolvedValue(mockJourney);
      const result = await service.findOne('journey-uuid', mockUser);
      expect(result).toEqual(mockJourney);
    });

    it('throws NotFoundException when journey belongs to different org', async () => {
      db.patientJourney.findUnique.mockResolvedValue({
        ...mockJourney,
        organization_id: 'other-org',
      });
      await expect(service.findOne('journey-uuid', mockUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateEpisodeStatus', () => {
    it('throws ForbiddenException when advancing PENDING episode while another is ACTIVE', async () => {
      const pendingEpisode = { id: 'ep-uuid', journey_id: 'journey-uuid', status: 'PENDING', order: 2 };
      db.patientJourney.findUnique.mockResolvedValue(mockJourney);
      db.patientEpisode.findUnique.mockResolvedValue(pendingEpisode);
      db.patientJourney.findFirst.mockResolvedValue({ id: 'other-active' }); // another active episode
      await expect(
        service.updateEpisodeStatus('journey-uuid', 'ep-uuid', { status: 'ACTIVE' }, mockUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx jest src/modules/journeys/journeys.service.spec.ts --no-coverage
```

Expected: FAIL.

- [ ] **Step 4: Implement service**

`src/modules/journeys/journeys.service.ts`:
```typescript
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CreateJourneyDto } from './dto/create-journey.dto';
import { UpdateJourneyStatusDto } from './dto/update-journey-status.dto';
import { UpdateEpisodeStatusDto } from './dto/update-episode-status.dto';

@Injectable()
export class JourneysService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(patientId: string, dto: CreateJourneyDto, user: AuthContext) {
    const patient = await this.prismaService.db.patient.findUnique({
      where: { id: patientId, is_deleted: false },
    });
    if (!patient) throw new NotFoundException(`Patient ${patientId} not found`);

    const existingActive = await this.prismaService.db.patientJourney.findFirst({
      where: {
        patient_id: patientId,
        organization_id: user.organizationId,
        journey_template_id: dto.journey_template_id,
        status: 'ACTIVE',
        is_deleted: false,
      },
    });
    if (existingActive) {
      throw new ConflictException('Patient already has an active journey of this type');
    }

    const template = await this.prismaService.db.journeyTemplate.findUnique({
      where: { id: dto.journey_template_id },
      include: { episodes: { orderBy: { order: 'asc' } } },
    });
    if (!template) throw new NotFoundException(`Journey template ${dto.journey_template_id} not found`);

    return this.prismaService.$transaction(async (tx) => {
      const journey = await tx.patientJourney.create({
        data: {
          patient_id: patientId,
          organization_id: user.organizationId,
          journey_template_id: dto.journey_template_id,
          created_by_id: user.profileId,
          status: 'ACTIVE',
        },
      });

      const now = new Date();
      await tx.patientEpisode.createMany({
        data: template.episodes.map((ep, index) => ({
          journey_id: journey.id,
          episode_template_id: ep.id,
          name: ep.name,
          order: ep.order,
          status: index === 0 ? 'ACTIVE' : 'PENDING',
          started_at: index === 0 ? now : null,
        })),
      });

      return tx.patientJourney.findUnique({
        where: { id: journey.id },
        include: { episodes: { orderBy: { order: 'asc' } } },
      });
    });
  }

  findAllForPatient(patientId: string, user: AuthContext) {
    return this.prismaService.db.patientJourney.findMany({
      where: {
        patient_id: patientId,
        organization_id: user.organizationId,
        is_deleted: false,
      },
      include: { episodes: { where: { is_deleted: false }, orderBy: { order: 'asc' } } },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: string, user: AuthContext) {
    const journey = await this.prismaService.db.patientJourney.findUnique({
      where: { id, is_deleted: false },
      include: { episodes: { where: { is_deleted: false }, orderBy: { order: 'asc' } } },
    });
    if (!journey || journey.organization_id !== user.organizationId) {
      throw new NotFoundException(`Journey ${id} not found`);
    }
    return journey;
  }

  async updateStatus(id: string, dto: UpdateJourneyStatusDto, user: AuthContext) {
    await this.findOne(id, user);
    return this.prismaService.db.patientJourney.update({
      where: { id },
      data: { status: dto.status, ended_at: new Date() },
    });
  }

  async updateEpisodeStatus(
    journeyId: string,
    episodeId: string,
    dto: UpdateEpisodeStatusDto,
    user: AuthContext,
  ) {
    await this.findOne(journeyId, user);

    const episode = await this.prismaService.db.patientEpisode.findUnique({
      where: { id: episodeId, is_deleted: false },
    });
    if (!episode || episode.journey_id !== journeyId) {
      throw new NotFoundException(`Episode ${episodeId} not found`);
    }

    if (dto.status === 'ACTIVE') {
      const anotherActive = await this.prismaService.db.patientJourney.findFirst({
        where: {
          id: journeyId,
          episodes: { some: { status: 'ACTIVE', id: { not: episodeId }, is_deleted: false } },
        },
      });
      if (anotherActive) {
        throw new ForbiddenException('Complete the current active episode before activating another');
      }
    }

    return this.prismaService.db.patientEpisode.update({
      where: { id: episodeId },
      data: {
        status: dto.status,
        started_at: dto.status === 'ACTIVE' ? new Date() : undefined,
        ended_at: dto.status === 'COMPLETED' ? new Date() : undefined,
      },
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest src/modules/journeys/journeys.service.spec.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 6: Implement controller and module**

`src/modules/journeys/journeys.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JourneysService } from './journeys.service';
import { CreateJourneyDto } from './dto/create-journey.dto';
import { UpdateJourneyStatusDto } from './dto/update-journey-status.dto';
import { UpdateEpisodeStatusDto } from './dto/update-episode-status.dto';
import { JourneyDto } from './dto/journey.dto';
import { ApiStandardResponse, ApiPaginatedResponse } from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

@ApiTags('Journeys')
@Controller()
export class JourneysController {
  constructor(private readonly journeysService: JourneysService) {}

  @Post('patients/:patientId/journeys')
  @ApiStandardResponse(JourneyDto)
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateJourneyDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.journeysService.create(patientId, dto, user);
  }

  @Get('patients/:patientId/journeys')
  @ApiPaginatedResponse(JourneyDto)
  findAllForPatient(
    @Param('patientId') patientId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.journeysService.findAllForPatient(patientId, user);
  }

  @Get('journeys/:id')
  @ApiStandardResponse(JourneyDto)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return this.journeysService.findOne(id, user);
  }

  @Patch('journeys/:id/status')
  @ApiStandardResponse(JourneyDto)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateJourneyStatusDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.journeysService.updateStatus(id, dto, user);
  }

  @Patch('journeys/:id/episodes/:episodeId/status')
  @ApiStandardResponse(JourneyDto)
  updateEpisodeStatus(
    @Param('id') id: string,
    @Param('episodeId') episodeId: string,
    @Body() dto: UpdateEpisodeStatusDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.journeysService.updateEpisodeStatus(id, episodeId, dto, user);
  }
}
```

`src/modules/journeys/journeys.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { JourneysController } from './journeys.controller';
import { JourneysService } from './journeys.service';

@Module({
  controllers: [JourneysController],
  providers: [JourneysService],
})
export class JourneysModule {}
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/journeys/
git commit -m "feat(journeys): add journey management with auto-episode creation from templates"
```

---

## Task 7: Visits Module

**Files:**
- Create: `src/modules/visits/dto/create-visit.dto.ts`
- Create: `src/modules/visits/dto/update-visit.dto.ts`
- Create: `src/modules/visits/dto/update-visit-status.dto.ts`
- Create: `src/modules/visits/dto/visit.dto.ts`
- Create: `src/modules/visits/visits.service.ts`
- Create: `src/modules/visits/visits.service.spec.ts`
- Create: `src/modules/visits/visits.controller.ts`
- Create: `src/modules/visits/visits.module.ts`

- [ ] **Step 1: Create DTOs**

`src/modules/visits/dto/create-visit.dto.ts`:
```typescript
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { VisitPriority, VisitType } from '@prisma/client';

export class CreateVisitDto {
  @IsUUID() assigned_doctor_id: string;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsEnum(VisitType) visit_type: VisitType;
  @IsEnum(VisitPriority) priority: VisitPriority;
  @IsDateString() scheduled_at: string;
  @IsString() @IsOptional() notes?: string;
}
```

`src/modules/visits/dto/update-visit.dto.ts`:
```typescript
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { VisitPriority, VisitType } from '@prisma/client';

export class UpdateVisitDto {
  @IsUUID() @IsOptional() assigned_doctor_id?: string;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsEnum(VisitType) @IsOptional() visit_type?: VisitType;
  @IsEnum(VisitPriority) @IsOptional() priority?: VisitPriority;
  @IsDateString() @IsOptional() scheduled_at?: string;
  @IsString() @IsOptional() notes?: string;
}
```

`src/modules/visits/dto/update-visit-status.dto.ts`:
```typescript
import { IsEnum } from 'class-validator';
import { VisitStatus } from '@prisma/client';

export class UpdateVisitStatusDto {
  @IsEnum(VisitStatus) status: VisitStatus;
}
```

`src/modules/visits/dto/visit.dto.ts`:
```typescript
export class VisitDto {
  id: string;
  episode_id: string;
  assigned_doctor_id: string;
  branch_id: string;
  visit_type: string;
  priority: string;
  status: string;
  scheduled_at: Date;
  checked_in_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  notes: string | null;
  created_by_id: string;
  created_at: Date;
}
```

- [ ] **Step 2: Write failing tests**

`src/modules/visits/visits.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VisitsService } from './visits.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-uuid',
  organizationId: 'org-uuid',
  activeBranchId: 'branch-uuid',
  roles: ['RECEPTIONIST'],
  branchIds: ['branch-uuid'],
};

const mockEpisodeWithJourney = {
  id: 'ep-uuid',
  journey_id: 'journey-uuid',
  is_deleted: false,
  journey: { organization_id: 'org-uuid' },
};

const mockVisit = {
  id: 'visit-uuid',
  episode_id: 'ep-uuid',
  assigned_doctor_id: 'doctor-uuid',
  branch_id: 'branch-uuid',
  visit_type: 'FOLLOW_UP',
  priority: 'NORMAL',
  status: 'SCHEDULED',
  scheduled_at: new Date(),
  checked_in_at: null,
  started_at: null,
  completed_at: null,
  notes: null,
  created_by_id: 'profile-uuid',
  is_deleted: false,
  episode: { journey: { organization_id: 'org-uuid' } },
};

describe('VisitsService', () => {
  let service: VisitsService;
  let db: any;

  beforeEach(async () => {
    db = {
      patientEpisode: { findUnique: jest.fn() },
      visit: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisitsService,
        { provide: PrismaService, useValue: { db } },
      ],
    }).compile();
    service = module.get<VisitsService>(VisitsService);
  });

  describe('create', () => {
    it('creates a visit when episode is in the user org', async () => {
      db.patientEpisode.findUnique.mockResolvedValue(mockEpisodeWithJourney);
      db.visit.create.mockResolvedValue(mockVisit);
      const result = await service.create('ep-uuid', {
        assigned_doctor_id: 'doctor-uuid',
        visit_type: 'FOLLOW_UP' as any,
        priority: 'NORMAL' as any,
        scheduled_at: new Date().toISOString(),
      }, mockUser);
      expect(result).toEqual(mockVisit);
    });

    it('throws NotFoundException when episode is in a different org', async () => {
      db.patientEpisode.findUnique.mockResolvedValue({
        ...mockEpisodeWithJourney,
        journey: { organization_id: 'other-org' },
      });
      await expect(
        service.create('ep-uuid', {
          assigned_doctor_id: 'doctor-uuid',
          visit_type: 'FOLLOW_UP' as any,
          priority: 'NORMAL' as any,
          scheduled_at: new Date().toISOString(),
        }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('throws BadRequestException on invalid status transition', async () => {
      db.visit.findUnique.mockResolvedValue({ ...mockVisit, status: 'COMPLETED' });
      await expect(
        service.updateStatus('visit-uuid', { status: 'CHECKED_IN' as any }, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets checked_in_at when transitioning to CHECKED_IN', async () => {
      db.visit.findUnique.mockResolvedValue({ ...mockVisit, status: 'SCHEDULED' });
      db.visit.update.mockResolvedValue({ ...mockVisit, status: 'CHECKED_IN', checked_in_at: new Date() });
      const result = await service.updateStatus('visit-uuid', { status: 'CHECKED_IN' as any }, mockUser);
      expect(db.visit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CHECKED_IN', checked_in_at: expect.any(Date) }),
        }),
      );
      expect(result.status).toBe('CHECKED_IN');
    });

    it('sets started_at when transitioning to IN_PROGRESS', async () => {
      db.visit.findUnique.mockResolvedValue({ ...mockVisit, status: 'CHECKED_IN' });
      db.visit.update.mockResolvedValue({ ...mockVisit, status: 'IN_PROGRESS', started_at: new Date() });
      await service.updateStatus('visit-uuid', { status: 'IN_PROGRESS' as any }, mockUser);
      expect(db.visit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'IN_PROGRESS', started_at: expect.any(Date) }),
        }),
      );
    });

    it('sets completed_at when transitioning to COMPLETED', async () => {
      db.visit.findUnique.mockResolvedValue({ ...mockVisit, status: 'IN_PROGRESS' });
      db.visit.update.mockResolvedValue({ ...mockVisit, status: 'COMPLETED', completed_at: new Date() });
      await service.updateStatus('visit-uuid', { status: 'COMPLETED' as any }, mockUser);
      expect(db.visit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED', completed_at: expect.any(Date) }),
        }),
      );
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx jest src/modules/visits/visits.service.spec.ts --no-coverage
```

Expected: FAIL.

- [ ] **Step 4: Implement service**

`src/modules/visits/visits.service.ts`:
```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { VisitStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { UpdateVisitStatusDto } from './dto/update-visit-status.dto';

const VALID_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  SCHEDULED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const STATUS_TIMESTAMPS: Partial<Record<VisitStatus, string>> = {
  CHECKED_IN: 'checked_in_at',
  IN_PROGRESS: 'started_at',
  COMPLETED: 'completed_at',
};

@Injectable()
export class VisitsService {
  constructor(private readonly prismaService: PrismaService) {}

  private async assertEpisodeInOrg(episodeId: string, organizationId: string) {
    const episode = await this.prismaService.db.patientEpisode.findUnique({
      where: { id: episodeId, is_deleted: false },
      include: { journey: { select: { organization_id: true } } },
    });
    if (!episode || episode.journey.organization_id !== organizationId) {
      throw new NotFoundException(`Episode ${episodeId} not found`);
    }
    return episode;
  }

  async create(episodeId: string, dto: CreateVisitDto, user: AuthContext) {
    await this.assertEpisodeInOrg(episodeId, user.organizationId);
    const branchId = dto.branch_id ?? user.activeBranchId;
    if (!branchId) throw new BadRequestException('branch_id is required');
    return this.prismaService.db.visit.create({
      data: {
        episode_id: episodeId,
        assigned_doctor_id: dto.assigned_doctor_id,
        branch_id: branchId,
        visit_type: dto.visit_type,
        priority: dto.priority,
        scheduled_at: new Date(dto.scheduled_at),
        notes: dto.notes ?? null,
        created_by_id: user.profileId,
      },
    });
  }

  async findAllForEpisode(episodeId: string, user: AuthContext) {
    await this.assertEpisodeInOrg(episodeId, user.organizationId);
    return this.prismaService.db.visit.findMany({
      where: { episode_id: episodeId, is_deleted: false },
      orderBy: { scheduled_at: 'asc' },
    });
  }

  async findOne(id: string, user: AuthContext) {
    const visit = await this.prismaService.db.visit.findUnique({
      where: { id, is_deleted: false },
      include: { episode: { include: { journey: { select: { organization_id: true } } } } },
    });
    if (!visit || visit.episode.journey.organization_id !== user.organizationId) {
      throw new NotFoundException(`Visit ${id} not found`);
    }
    return visit;
  }

  async update(id: string, dto: UpdateVisitDto, user: AuthContext) {
    await this.findOne(id, user);
    return this.prismaService.db.visit.update({
      where: { id },
      data: {
        ...(dto.assigned_doctor_id !== undefined && { assigned_doctor_id: dto.assigned_doctor_id }),
        ...(dto.branch_id !== undefined && { branch_id: dto.branch_id }),
        ...(dto.visit_type !== undefined && { visit_type: dto.visit_type }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.scheduled_at !== undefined && { scheduled_at: new Date(dto.scheduled_at) }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async updateStatus(id: string, dto: UpdateVisitStatusDto, user: AuthContext) {
    const visit = await this.findOne(id, user);
    const allowedNext = VALID_TRANSITIONS[visit.status as VisitStatus];
    if (!allowedNext.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${visit.status} to ${dto.status}`,
      );
    }
    const timestampField = STATUS_TIMESTAMPS[dto.status];
    return this.prismaService.db.visit.update({
      where: { id },
      data: {
        status: dto.status,
        ...(timestampField ? { [timestampField]: new Date() } : {}),
      },
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest src/modules/visits/visits.service.spec.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 6: Implement controller and module**

`src/modules/visits/visits.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VisitsService } from './visits.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { UpdateVisitStatusDto } from './dto/update-visit-status.dto';
import { VisitDto } from './dto/visit.dto';
import { ApiStandardResponse, ApiPaginatedResponse } from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

@ApiTags('Visits')
@Controller()
export class VisitsController {
  constructor(private readonly visitsService: VisitsService) {}

  @Post('episodes/:episodeId/visits')
  @ApiStandardResponse(VisitDto)
  create(
    @Param('episodeId') episodeId: string,
    @Body() dto: CreateVisitDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.create(episodeId, dto, user);
  }

  @Get('episodes/:episodeId/visits')
  @ApiPaginatedResponse(VisitDto)
  findAll(
    @Param('episodeId') episodeId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findAllForEpisode(episodeId, user);
  }

  @Get('visits/:id')
  @ApiStandardResponse(VisitDto)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return this.visitsService.findOne(id, user);
  }

  @Patch('visits/:id')
  @ApiStandardResponse(VisitDto)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVisitDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.update(id, dto, user);
  }

  @Patch('visits/:id/status')
  @ApiStandardResponse(VisitDto)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateVisitStatusDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.updateStatus(id, dto, user);
  }
}
```

`src/modules/visits/visits.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  controllers: [VisitsController],
  providers: [VisitsService],
})
export class VisitsModule {}
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/visits/
git commit -m "feat(visits): add visit CRUD with server-enforced status transitions and auto-timestamps"
```

---

## Task 8: Wire Modules into AppModule + Lint + Verify

**Files:**
- Modify: `src/app.module.ts`

- [ ] **Step 1: Import all 5 new modules in `src/app.module.ts`**

Add these imports at the top of the file (with the other module imports):
```typescript
import { SpecialtiesModule } from './modules/specialties/specialties.module';
import { JourneyTemplatesModule } from './modules/journey-templates/journey-templates.module';
import { PatientsModule } from './modules/patients/patients.module';
import { JourneysModule } from './modules/journeys/journeys.module';
import { VisitsModule } from './modules/visits/visits.module';
```

And add them to the `imports` array in `@Module`:
```typescript
SpecialtiesModule,
JourneyTemplatesModule,
PatientsModule,
JourneysModule,
VisitsModule,
```

- [ ] **Step 2: Run full test suite**

```bash
npm run test
```

Expected: All tests pass including the 4 new service spec files.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: No errors. Fix any that appear (unused imports, floating promises, explicit `any`).

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: Successful compile, no TypeScript errors.

- [ ] **Step 5: Smoke test the server**

```bash
npm run start:dev
```

Open `http://localhost:3000/api` (Swagger). Verify these tag groups appear:
- Specialties
- Journey Templates
- Patients
- Journeys
- Visits

- [ ] **Step 6: Final commit**

```bash
git add src/app.module.ts
git commit -m "feat: wire specialties, journey-templates, patients, journeys, and visits modules into AppModule"
```
