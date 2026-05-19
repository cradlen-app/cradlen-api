# OB/GYN Patient History Template v4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump `obgyn_patient_history` template from v3 → v4, wiring the missing `social_history` section, completing medication fields, adding menopause/HRT history, HPV/Bethesda screening fields, and blood group/Rh — plus dropping the orphaned `husband_name` column.

**Architecture:** Single Prisma migration adds/drops three columns; the DTO, service `SINGLETON_JSON_FIELDS`, and `ALLOWED_PATHS` are updated in code; the seed is bumped to v4 with two modified sections and two new sections. Everything lands in one commit chain.

**Tech Stack:** NestJS v11, Prisma v7, TypeScript, class-validator, Jest

**Spec:** `docs/superpowers/specs/2026-05-19-obgyn-patient-history-template-v4-design.md`

---

## File Map

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `BloodGroupRh` enum; drop `husband_name`, add `menopause_history Json?` + `blood_group_rh BloodGroupRh?` on `PatientObgynHistory` |
| `src/specialties/obgyn/patient-history/dto/obgyn-history.dto.ts` | New `MenopauseHistoryDto`; extend `ScreeningHistoryDto`, `UpdateObgynHistoryDto`, `PatientObgynHistoryDto` |
| `src/specialties/obgyn/patient-history/obgyn-history.service.ts` | Add `'menopause_history'` to `SINGLETON_JSON_FIELDS`; add explicit `blood_group_rh` handler |
| `src/builder/fields/allowed-paths.ts` | 14 new entries under `PATIENT_OBGYN_HISTORY` |
| `prisma/seeds/obgyn-patient-history.ts` | Modify screening + medications sections; add social_history + menopause_history sections; bump `TEMPLATE_VERSION` to 4 |

---

## Task 1: Schema — Add BloodGroupRh enum and migrate PatientObgynHistory

**Files:**
- Modify: `prisma/schema.prisma` (around line 1352, `PatientObgynHistory` model)

- [ ] **Step 1: Add the `BloodGroupRh` enum to schema.prisma**

  Open `prisma/schema.prisma`. Add the following enum directly above the `// ----- OB/GYN specialty sidecars -----` comment (around line 1350):

  ```prisma
  enum BloodGroupRh {
    A_POS
    A_NEG
    B_POS
    B_NEG
    AB_POS
    AB_NEG
    O_POS
    O_NEG
  }
  ```

- [ ] **Step 2: Update the PatientObgynHistory model**

  In `prisma/schema.prisma`, inside the `PatientObgynHistory` model:

  **Remove** (line 1357):
  ```prisma
  husband_name              String?
  ```

  **Add** after the `social_history` line (after `social_history Json?`):
  ```prisma
  menopause_history         Json?
  blood_group_rh            BloodGroupRh?
  ```

  The model block (lines 1352–1375) should now read:
  ```prisma
  model PatientObgynHistory {
    id                        String                        @id @default(uuid()) @db.Uuid
    patient_id                String                        @unique @db.Uuid
    patient                   Patient                       @relation(fields: [patient_id], references: [id], onDelete: Cascade)
    revisions                 PatientObgynHistoryRevision[]
    gynecological_baseline    Json?
    gynecologic_procedures    Json?
    screening_history         Json?
    obstetric_summary         Json?
    medical_chronic_illnesses Json?
    family_history            Json?
    fertility_history         Json?
    social_history            Json?
    menopause_history         Json?
    blood_group_rh            BloodGroupRh?
    version                   Int                           @default(1)
    updated_by_id             String?                       @db.Uuid
    updated_by                Profile?                      @relation("PatientObgynHistoryUpdatedBy", fields: [updated_by_id], references: [id], onDelete: SetNull)
    is_deleted                Boolean                       @default(false)
    deleted_at                DateTime?
    created_at                DateTime                      @default(now())
    updated_at                DateTime                      @updatedAt

    @@map("patient_obgyn_histories")
  }
  ```

- [ ] **Step 3: Run the migration**

  ```bash
  npx prisma migrate dev --name obgyn_history_v4_menopause_bloodgroup
  ```

  Expected output:
  ```
  Your database is now in sync with your schema.
  ✔  Generated Prisma Client
  ```

  If prompted about dropping data on `husband_name`, confirm — the column has no consumers.

- [ ] **Step 4: Verify Prisma client regenerated**

  ```bash
  npx prisma generate
  ```

  Expected: `✔  Generated Prisma Client` with no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add prisma/schema.prisma prisma/migrations/
  git commit -m "feat(obgyn-history): add BloodGroupRh enum, menopause_history + blood_group_rh columns, drop husband_name"
  ```

---

## Task 2: DTOs — MenopauseHistoryDto, ScreeningHistoryDto extension, UpdateObgynHistoryDto, PatientObgynHistoryDto

**Files:**
- Modify: `src/specialties/obgyn/patient-history/dto/obgyn-history.dto.ts`

- [ ] **Step 1: Add `IsEnum` import and `BloodGroupRh` import**

  At the top of `obgyn-history.dto.ts`, add `IsEnum` to the class-validator import and add a Prisma import:

  ```typescript
  import {
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    IsUUID,
    Min,
    ValidateNested,
  } from 'class-validator';
  import { Type } from 'class-transformer';
  import { BloodGroupRh } from '@prisma/client';
  ```

- [ ] **Step 2: Extend `ScreeningHistoryDto` with HPV result and Bethesda category**

  Replace the existing `ScreeningHistoryDto` class (lines 34–40):

  ```typescript
  export class ScreeningHistoryDto {
    @IsOptional() @IsString() pap_smear?: string;
    @IsOptional() @IsString() pap_smear_date?: string;
    @IsOptional() @IsString() mammography?: string;
    @IsOptional() @IsString() mammography_date?: string;
    @IsOptional() @IsArray() @IsString({ each: true }) vaccines?: string[];
    @IsOptional() @IsString() hpv_result?: string;
    @IsOptional() @IsString() bethesda_category?: string;
  }
  ```

- [ ] **Step 3: Add `MenopauseHistoryDto` after `SocialHistoryDto`**

  After the `SocialHistoryDto` class (after line 79), insert:

  ```typescript
  export class MenopauseHistoryDto {
    @IsOptional() @IsString() menopausal_status?: string;
    @IsOptional() @IsNumber() age_at_menopause?: number;
    @IsOptional() @IsString() hrt_current?: string;
    @IsOptional() @IsString() hrt_details?: string;
  }
  ```

- [ ] **Step 4: Extend `UpdateObgynHistoryDto` with `menopause_history` and `blood_group_rh`**

  Inside `UpdateObgynHistoryDto`, after the `social_history` block (after line 192), add:

  ```typescript
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MenopauseHistoryDto)
  menopause_history?: MenopauseHistoryDto;

  @IsOptional()
  @IsEnum(BloodGroupRh)
  blood_group_rh?: BloodGroupRh;
  ```

- [ ] **Step 5: Extend `PatientObgynHistoryDto` with `menopause_history` and `blood_group_rh`**

  Inside `PatientObgynHistoryDto` (after line 234 `social_history`), add:

  ```typescript
  menopause_history!: unknown;
  blood_group_rh!: BloodGroupRh | null;
  ```

- [ ] **Step 6: Build to confirm no TypeScript errors**

  ```bash
  npm run build
  ```

  Expected: build completes with `webpack 5 compiled successfully`.

- [ ] **Step 7: Commit**

  ```bash
  git add src/specialties/obgyn/patient-history/dto/obgyn-history.dto.ts
  git commit -m "feat(obgyn-history): add MenopauseHistoryDto, extend ScreeningHistoryDto + UpdateObgynHistoryDto + PatientObgynHistoryDto for v4"
  ```

---

## Task 3: Service — menopause_history in SINGLETON_JSON_FIELDS + blood_group_rh handler

**Files:**
- Modify: `src/specialties/obgyn/patient-history/obgyn-history.service.ts`

- [ ] **Step 1: Add `'menopause_history'` to `SINGLETON_JSON_FIELDS`**

  Locate `SINGLETON_JSON_FIELDS` (lines 22–31). Replace it with:

  ```typescript
  const SINGLETON_JSON_FIELDS = [
    'gynecological_baseline',
    'gynecologic_procedures',
    'screening_history',
    'obstetric_summary',
    'medical_chronic_illnesses',
    'family_history',
    'fertility_history',
    'social_history',
    'menopause_history',
  ] as const;
  ```

- [ ] **Step 2: Add explicit `blood_group_rh` handler in `patch()`**

  In the `patch()` method, after the `SINGLETON_JSON_FIELDS` for-loop (after line ~101), add:

  ```typescript
  if (dto.blood_group_rh !== undefined) {
    data.blood_group_rh = dto.blood_group_rh;
    changedSections.push('blood_group_rh');
  }
  ```

  The full relevant block in `patch()` should now look like:

  ```typescript
  const data: Prisma.PatientObgynHistoryUncheckedUpdateInput = {
    updated_by_id: user.profileId,
  };
  for (const field of SINGLETON_JSON_FIELDS) {
    if (!(field in dto)) continue;
    const value = (dto as Record<string, unknown>)[field];
    (data as Record<string, unknown>)[field] =
      value as Prisma.InputJsonValue;
    changedSections.push(field);
  }

  if (dto.blood_group_rh !== undefined) {
    data.blood_group_rh = dto.blood_group_rh;
    changedSections.push('blood_group_rh');
  }

  // ----- Child collection diffs -----
  ```

- [ ] **Step 3: Build to confirm no TypeScript errors**

  ```bash
  npm run build
  ```

  Expected: `webpack 5 compiled successfully`.

- [ ] **Step 4: Commit**

  ```bash
  git add src/specialties/obgyn/patient-history/obgyn-history.service.ts
  git commit -m "feat(obgyn-history): wire menopause_history into SINGLETON_JSON_FIELDS; add blood_group_rh update path"
  ```

---

## Task 4: ALLOWED_PATHS — 14 new entries under PATIENT_OBGYN_HISTORY

**Files:**
- Modify: `src/builder/fields/allowed-paths.ts`

- [ ] **Step 1: Add 14 new paths to `PATIENT_OBGYN_HISTORY`**

  Locate the `PATIENT_OBGYN_HISTORY` array (starting line 76). After the last existing entry (`'allergies.associated_symptoms'`, line 119), add:

  ```typescript
  // social_history — column existed but paths were missing
  'social_history.smoking',
  'social_history.alcohol',
  'social_history.occupation',
  // medications — 4 fields present in DTO but absent from template
  'medications.dose',
  'medications.frequency',
  'medications.to_date',
  'medications.is_ongoing',
  // screening_history — HPV/Bethesda clinical fields
  'screening_history.hpv_result',
  'screening_history.bethesda_category',
  // menopause_history — new JSON column
  'menopause_history.menopausal_status',
  'menopause_history.age_at_menopause',
  'menopause_history.hrt_current',
  'menopause_history.hrt_details',
  // blood_group_rh — top-level enum column (no dot)
  'blood_group_rh',
  ```

  The end of the `PATIENT_OBGYN_HISTORY` array should now read:
  ```typescript
  'medications.drug_name',
  'medications.medication_id',
  'medications.indication',
  'medications.from_date',
  'medications.dose',
  'medications.frequency',
  'medications.to_date',
  'medications.is_ongoing',
  'allergies.allergy_to',
  'allergies.associated_symptoms',
  'social_history.smoking',
  'social_history.alcohol',
  'social_history.occupation',
  'screening_history.hpv_result',
  'screening_history.bethesda_category',
  'menopause_history.menopausal_status',
  'menopause_history.age_at_menopause',
  'menopause_history.hrt_current',
  'menopause_history.hrt_details',
  'blood_group_rh',
  ```

- [ ] **Step 2: Run the ALLOWED_PATHS unit test**

  ```bash
  npx jest src/builder/fields/allowed-paths.spec.ts --no-coverage
  ```

  Expected: all 4 tests pass (`PASS`). The first test (`accepts every path declared in ALLOWED_PATHS`) automatically exercises all new paths through `validateBinding`.

- [ ] **Step 3: Run the contract test to confirm no regressions**

  ```bash
  npx jest src/builder/fields/allowed-paths.contract.spec.ts --no-coverage
  ```

  Expected: all tests pass. The contract test only checks BookVisit/MedicalRep namespaces — the `PATIENT_OBGYN_HISTORY` namespace has an explicit TODO noting it is not yet introspected there, so no changes to that test file are needed.

- [ ] **Step 4: Commit**

  ```bash
  git add src/builder/fields/allowed-paths.ts
  git commit -m "feat(obgyn-history): add 14 ALLOWED_PATHS entries for social_history, medications, screening HPV/Bethesda, menopause_history, blood_group_rh"
  ```

---

## Task 5: Seed v4 — modify sections + add Social History + Menopause History

**Files:**
- Modify: `prisma/seeds/obgyn-patient-history.ts`

The final SECTIONS order will be (14 sections):
1. menstrual_history, 2. gynecologic_procedures, 3. contraceptives, 4. screening_vaccinations *(modified)*, **5. social_history (NEW)**, 6. obstetric_summary, 7. pregnancies, 8. medical_chronic_illnesses, 9. non_gyn_surgeries, 10. allergies, 11. medications *(modified)*, 12. family_history, **13. menopause_history (NEW)**, 14. fertility_history

- [ ] **Step 1: Bump the version constant**

  Change line 35:
  ```typescript
  const TEMPLATE_VERSION = 4;
  ```

- [ ] **Step 2: Add HPV result + Bethesda category to `screening_vaccinations` section**

  In the `screening_vaccinations` section fields array, after the `vaccines` field object (after the closing `},` of the vaccines field, around line 319), add:

  ```typescript
  {
    code: 'hpv_result',
    label: 'HPV test result',
    type: 'SELECT',
    binding: {
      namespace: 'PATIENT_OBGYN_HISTORY',
      path: 'screening_history.hpv_result',
    },
    config: {
      ui: { placeholder: 'Ex : Negative', colSpan: 6 },
      validation: {
        options: [
          opt('POSITIVE', 'Positive'),
          opt('NEGATIVE', 'Negative'),
          opt('PENDING', 'Pending'),
          opt('NOT_DONE', 'Not done'),
        ],
      },
    },
  },
  {
    code: 'bethesda_category',
    label: 'Bethesda category',
    type: 'SELECT',
    binding: {
      namespace: 'PATIENT_OBGYN_HISTORY',
      path: 'screening_history.bethesda_category',
    },
    config: {
      ui: { placeholder: 'Ex : NILM', colSpan: 6 },
      validation: {
        options: [
          opt('NILM', 'NILM (Normal)'),
          opt('ASCUS', 'ASC-US'),
          opt('ASC_H', 'ASC-H'),
          opt('LSIL', 'LSIL'),
          opt('HSIL', 'HSIL'),
          opt('AGC', 'AGC'),
          opt('AIS', 'AIS'),
          opt('SQUAMOUS_CELL_CARCINOMA', 'Squamous cell carcinoma'),
          opt('NOT_DONE', 'Not done'),
        ],
      },
    },
  },
  ```

- [ ] **Step 3: Add `dose`, `frequency`, `to_date`, `is_ongoing` to the `medications` section**

  In the `medications` section fields array, after the `from_date` field object (after the `},` closing the from_date field, around line 641), add:

  ```typescript
  {
    code: 'dose',
    label: 'Dose',
    type: 'TEXT',
    binding: {
      namespace: 'PATIENT_OBGYN_HISTORY',
      path: 'medications.dose',
    },
    config: { ui: { placeholder: 'Ex : 500mg', colSpan: 3 } },
  },
  {
    code: 'frequency',
    label: 'Frequency',
    type: 'TEXT',
    binding: {
      namespace: 'PATIENT_OBGYN_HISTORY',
      path: 'medications.frequency',
    },
    config: { ui: { placeholder: 'Ex : twice daily', colSpan: 3 } },
  },
  {
    code: 'to_date',
    label: 'To',
    type: 'DATE',
    binding: {
      namespace: 'PATIENT_OBGYN_HISTORY',
      path: 'medications.to_date',
    },
    config: { ui: { placeholder: 'Ex : 1/1/2026', colSpan: 3 } },
  },
  {
    code: 'is_ongoing',
    label: 'Ongoing',
    type: 'SELECT',
    binding: {
      namespace: 'PATIENT_OBGYN_HISTORY',
      path: 'medications.is_ongoing',
    },
    config: {
      ui: { placeholder: 'Ex : Yes', colSpan: 3 },
      validation: {
        options: [opt('YES', 'Yes'), opt('NO', 'No')],
      },
    },
  },
  ```

- [ ] **Step 4: Insert the new `social_history` section**

  In the `SECTIONS` array, insert the following **between** the `screening_vaccinations` section and the `obstetric_summary` section (after the `},` that closes screening_vaccinations, around line 320):

  ```typescript
  {
    code: 'social_history',
    name: 'Social History',
    group: 'Social History',
    fields: [
      {
        code: 'smoking',
        label: 'Smoking',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'social_history.smoking',
        },
        config: {
          ui: { placeholder: 'Ex : Never', colSpan: 4 },
          validation: {
            options: [
              opt('NEVER', 'Never'),
              opt('CURRENT', 'Current'),
              opt('FORMER', 'Former'),
            ],
          },
        },
      },
      {
        code: 'alcohol',
        label: 'Alcohol use',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'social_history.alcohol',
        },
        config: {
          ui: { placeholder: 'Ex : Never', colSpan: 4 },
          validation: {
            options: [
              opt('NEVER', 'Never'),
              opt('OCCASIONAL', 'Occasional'),
              opt('REGULAR', 'Regular'),
              opt('FORMER', 'Former'),
            ],
          },
        },
      },
      {
        code: 'occupation',
        label: 'Occupation',
        type: 'TEXT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'social_history.occupation',
        },
        config: { ui: { placeholder: 'Ex : Teacher', colSpan: 4 } },
      },
      {
        code: 'blood_group_rh',
        label: 'Blood group / Rh',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'blood_group_rh',
        },
        config: {
          ui: { placeholder: 'Ex : O+', colSpan: 4 },
          validation: {
            options: [
              opt('A_POS', 'A+'),
              opt('A_NEG', 'A−'),
              opt('B_POS', 'B+'),
              opt('B_NEG', 'B−'),
              opt('AB_POS', 'AB+'),
              opt('AB_NEG', 'AB−'),
              opt('O_POS', 'O+'),
              opt('O_NEG', 'O−'),
            ],
          },
        },
      },
    ],
  },
  ```

- [ ] **Step 5: Insert the new `menopause_history` section**

  In the `SECTIONS` array, insert the following **between** the `family_history` section and the `fertility_history` section (after the `},` that closes family_history):

  ```typescript
  {
    code: 'menopause_history',
    name: 'Menopause History',
    group: 'Menopause & HRT',
    fields: [
      {
        code: 'menopausal_status',
        label: 'Menopausal status',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'menopause_history.menopausal_status',
        },
        config: {
          ui: { placeholder: 'Ex : Pre-menopausal', colSpan: 6 },
          validation: {
            options: [
              opt('PRE', 'Pre-menopausal'),
              opt('PERI', 'Peri-menopausal'),
              opt('POST', 'Post-menopausal'),
              opt('PREMATURE', 'Premature menopause'),
            ],
          },
        },
      },
      {
        code: 'age_at_menopause',
        label: 'Age at menopause',
        type: 'NUMBER',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'menopause_history.age_at_menopause',
        },
        config: {
          ui: { placeholder: 'Ex : 52', colSpan: 6 },
          validation: { min: 30, max: 65 },
          // SectionConfig.logic is typed as `any` — plain predicate objects work directly.
          logic: {
            predicates: [
              {
                effect: 'visible',
                when: {
                  in: { 'menopause_history.menopausal_status': ['POST', 'PREMATURE'] },
                },
              } as Predicate,
            ],
          },
        },
      },
      {
        code: 'hrt_current',
        label: 'On HRT',
        type: 'SELECT',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'menopause_history.hrt_current',
        },
        config: {
          ui: { placeholder: 'Ex : No', colSpan: 6 },
          validation: {
            options: [opt('YES', 'Yes'), opt('NO', 'No')],
          },
        },
      },
      {
        code: 'hrt_details',
        label: 'HRT details',
        type: 'TEXTAREA',
        binding: {
          namespace: 'PATIENT_OBGYN_HISTORY',
          path: 'menopause_history.hrt_details',
        },
        config: {
          ui: { placeholder: 'Ex : Estrogen-only patch since 2022' },
          logic: {
            predicates: [
              {
                effect: 'visible',
                when: { eq: { 'menopause_history.hrt_current': 'YES' } },
              } as Predicate,
            ],
          },
        },
      },
    ],
  },
  ```

- [ ] **Step 6: Verify the seed builds (TypeScript check)**

  ```bash
  npm run build
  ```

  Expected: `webpack 5 compiled successfully`.

- [ ] **Step 7: Run the seed**

  ```bash
  npx prisma db seed
  ```

  Expected output includes:
  ```
  Seeded obgyn_patient_history v4 (14 sections, activated).
  ```

- [ ] **Step 8: Verify v4 is active via the template API**

  Start the dev server and call the template endpoint (or use a REST client):
  ```
  GET /v1/form-templates/obgyn_patient_history
  Authorization: Bearer <valid-access-token>
  ```

  Assert the response:
  - `data.version` === `4`
  - `data.sections` contains sections with codes: `social_history` and `menopause_history`
  - `social_history` section has 4 fields: `smoking`, `alcohol`, `occupation`, `blood_group_rh`
  - `menopause_history` section has 4 fields: `menopausal_status`, `age_at_menopause`, `hrt_current`, `hrt_details`
  - `age_at_menopause` field has a `visible` predicate in its config
  - `hrt_details` field has a `visible` predicate in its config
  - `screening_vaccinations` section now has 7 fields (original 5 + `hpv_result` + `bethesda_category`)
  - `medications` repeatable section now has 8 fields (original 4 + `dose` + `frequency` + `to_date` + `is_ongoing`)

- [ ] **Step 9: Smoke-test the PATCH endpoint**

  Call `PATCH /v1/patients/:id/obgyn-history` with `If-Match: "1"` (or current version):
  ```json
  {
    "social_history": {
      "smoking": "NEVER",
      "alcohol": "OCCASIONAL",
      "occupation": "Teacher"
    },
    "blood_group_rh": "O_POS",
    "menopause_history": {
      "menopausal_status": "POST",
      "age_at_menopause": 52,
      "hrt_current": "NO"
    },
    "screening_history": {
      "hpv_result": "NEGATIVE",
      "bethesda_category": "NILM"
    }
  }
  ```

  Assert:
  - Response `200 OK`
  - `data.blood_group_rh` === `"O_POS"`
  - `data.social_history.smoking` === `"NEVER"`
  - `data.menopause_history.menopausal_status` === `"POST"`
  - `data.screening_history.hpv_result` === `"NEGATIVE"`
  - `data.version` incremented by 1

- [ ] **Step 10: Commit**

  ```bash
  git add prisma/seeds/obgyn-patient-history.ts
  git commit -m "feat(obgyn-history): seed obgyn_patient_history v4 — social_history + menopause sections, medication fields, HPV/Bethesda screening"
  ```

---

## Task 6: Final build + test run

- [ ] **Step 1: Run full test suite**

  ```bash
  npm run test
  ```

  Expected: all tests pass. The `allowed-paths.spec.ts` and `allowed-paths.contract.spec.ts` tests automatically cover the new paths.

- [ ] **Step 2: Build production bundle**

  ```bash
  npm run build
  ```

  Expected: `webpack 5 compiled successfully` with 0 errors.

- [ ] **Step 3: Done**

  All 6 tasks complete. The `obgyn_patient_history` template is now at v4 with:
  - Social History section (smoking, alcohol, occupation, blood_group_rh)
  - Menopause History section with visibility predicates
  - HPV result + Bethesda category added to Screening
  - Medication rows now include dose, frequency, to_date, is_ongoing
  - `husband_name` column dropped from the database