# OB/GYN Patient History Template v4

**Date:** 2026-05-19
**Branch:** feature/builder-obgyn-template
**Template code:** `obgyn_patient_history`
**Version bump:** v3 → v4

## Context

The existing `obgyn_patient_history` form-builder template (v3) has three confirmed gaps where DTO/schema already exist but the template never wired them up, plus three clinical completeness gaps identified during review. This update resolves all six in a single migration + seed bump.

**Confirmed gaps (no migration needed for columns themselves):**
- `social_history` JSON column and `SocialHistoryDto` exist but no section is seeded
- Medication rows are missing `dose`, `frequency`, `to_date`, `is_ongoing` despite DTO having all four
- `husband_name` is an orphaned column with no template binding or consumers

**Clinical completeness gaps (new columns needed):**
- No menopause / HRT history
- Screening lacks HPV result and Bethesda classification fields
- No blood group / Rh type at the patient history level

---

## 1. Schema Migration

**Migration name:** `obgyn_history_v4_menopause_bloodgroup`

| Operation | Detail |
|-----------|--------|
| `DROP COLUMN husband_name` | Orphaned column, no template binding, no DTO consumers |
| `ADD COLUMN menopause_history Json?` | New JSON column for menopause/HRT section |
| `ADD COLUMN blood_group_rh String?` | Top-level enum-backed string column (ABO/Rh type) |

**Prisma enum to add:**
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

**`PatientObgynHistory` model changes:**
```prisma
// Remove:
husband_name  String?

// Add:
menopause_history  Json?
blood_group_rh     BloodGroupRh?   // typed enum, not a raw String
```

---

## 2. DTO Changes

**File:** `src/specialties/obgyn/patient-history/dto/obgyn-history.dto.ts`

### New: `MenopauseHistoryDto`
```
menopausal_status   MenopauseStatus enum (PRE | PERI | POST | PREMATURE)
age_at_menopause?   number (optional — relevant only for POST and PREMATURE)
hrt_current         HrtStatus enum (YES | NO)
hrt_details?        string (optional — relevant only when hrt_current = YES)
```

### Extended: `ScreeningHistoryDto`
```
// Add:
hpv_result?          HpvResult enum (POSITIVE | NEGATIVE | PENDING | NOT_DONE)
bethesda_category?   BethesdaCategory enum (NILM | ASCUS | ASC_H | LSIL | HSIL | AGC | AIS | SQUAMOUS_CELL_CARCINOMA | NOT_DONE)
```

### Extended: `MedicationRowDto`
Verify that `dose?`, `frequency?`, `to_date?`, `is_ongoing?` are already present.
If missing, add them as optional fields.

### Extended: `UpdateObgynHistoryDto`
```
// Remove:
husband_name?

// Add:
menopause_history?   MenopauseHistoryDto
blood_group_rh?      BloodGroupRh  // Prisma enum — class-validator @IsEnum(BloodGroupRh)
```

### Extended: `PatientObgynHistoryDto` (response shape)
```
// Add:
menopause_history?   object  // JSON passthrough, typed by MenopauseHistoryDto shape
blood_group_rh?      BloodGroupRh
```

---

## 3. ALLOWED_PATHS Additions

**File:** `src/builder/fields/allowed-paths.ts`

14 new entries under `PATIENT_OBGYN_HISTORY`:

```typescript
// social_history (column exists, paths were missing)
'social_history.smoking',
'social_history.alcohol',
'social_history.occupation',

// medications repeatable (4 fields missing from template)
'medications.dose',
'medications.frequency',
'medications.to_date',
'medications.is_ongoing',

// screening_history extensions (new clinical fields)
'screening_history.hpv_result',
'screening_history.bethesda_category',

// menopause_history (new column)
'menopause_history.menopausal_status',
'menopause_history.age_at_menopause',
'menopause_history.hrt_current',
'menopause_history.hrt_details',

// top-level column (no dot — direct column binding)
'blood_group_rh',
```

---

## 4. Seed v4 Section Changes

**File:** `prisma/seeds/obgyn-patient-history.ts`

### Modified: Screening & Vaccinations section

Add two new fields after `vaccines`:

| Field code | Type | Options |
|-----------|------|---------|
| `hpv_result` | SELECT | POSITIVE, NEGATIVE, PENDING, NOT_DONE |
| `bethesda_category` | SELECT | NILM, ASCUS, ASC_H, LSIL, HSIL, AGC, AIS, SQUAMOUS_CELL_CARCINOMA, NOT_DONE |

Both optional, no predicates.

### Modified: Medications repeatable section

Add four new fields after `from_date`:

| Field code | Type | Notes |
|-----------|------|-------|
| `dose` | TEXT | e.g. "500mg" |
| `frequency` | TEXT | e.g. "twice daily" |
| `to_date` | DATE | Optional end date |
| `is_ongoing` | SELECT | YES, NO |

All optional.

### New: Social History section

Placement: after Screening & Vaccinations, before Obstetric Summary.

| Field code | Type | Options / Notes |
|-----------|------|----------------|
| `smoking` | SELECT | NEVER, CURRENT, FORMER |
| `alcohol` | SELECT | NEVER, OCCASIONAL, REGULAR, FORMER |
| `occupation` | TEXT | Free text |
| `blood_group_rh` | SELECT | A_POS, A_NEG, B_POS, B_NEG, AB_POS, AB_NEG, O_POS, O_NEG |

All optional, no predicates.

Note: `blood_group_rh` is a top-level column on `PatientObgynHistory` (not nested in `social_history` JSON), but is grouped here for logical UX coherence.

### New: Menopause History section

Placement: after Family History, before Fertility History.

| Field code | Type | Options | Predicate |
|-----------|------|---------|-----------|
| `menopausal_status` | SELECT | PRE, PERI, POST, PREMATURE | — |
| `age_at_menopause` | NUMBER | min 30, max 65 | visible when `menopausal_status` in [POST, PREMATURE] |
| `hrt_current` | SELECT | YES, NO | — |
| `hrt_details` | TEXTAREA | Free text | visible when `hrt_current` = YES |

All optional.

### Version bump
```typescript
const VERSION = 4;
```
Activation transaction: deactivate v3, publish v4 as active.

---

## 5. Service Layer Changes

**File:** `src/specialties/obgyn/patient-history/obgyn-history.service.ts`

| Change | Detail |
|--------|--------|
| Remove `husband_name` | Remove from Prisma update write path and from response mapper |
| Add `menopause_history` | Pass `dto.menopause_history` directly to `prisma.db.patientObgynHistory.update({ data: { menopause_history: dto.menopause_history } })` |
| Add `blood_group_rh` | Pass `dto.blood_group_rh` to Prisma update |
| Revision builder | No change — `buildRevision` already captures all changed fields dynamically |

No changes to transaction structure, child collection managers, or event emission.

---

## 6. Verification

```bash
# 1. Apply migration
npx prisma migrate dev --name obgyn_history_v4_menopause_bloodgroup

# 2. Regenerate types
npx prisma generate

# 3. Build
npm run build

# 4. Run seed
npx prisma db seed

# 5. Verify template version
# GET /v1/form-templates/obgyn_patient_history
# → response.version should be 4
# → response.sections should include "Social History" and "Menopause History"

# 6. Test PATCH endpoint
# PATCH /v1/patients/:id/obgyn-history with body:
# { social_history: { smoking: "NEVER", alcohol: "OCCASIONAL", occupation: "Teacher" },
#   blood_group_rh: "O_POS",
#   menopause_history: { menopausal_status: "POST", age_at_menopause: 52, hrt_current: "NO" } }
# → 200 OK, revision created, event emitted

# 7. Unit tests
npm run test
```

---

## Affected Files

| File | Change type |
|------|-------------|
| `prisma/schema.prisma` | Add enum `BloodGroupRh`, modify `PatientObgynHistory` model |
| `prisma/migrations/<timestamp>_obgyn_history_v4_menopause_bloodgroup/migration.sql` | New migration |
| `src/specialties/obgyn/patient-history/dto/obgyn-history.dto.ts` | New `MenopauseHistoryDto`, extend `ScreeningHistoryDto`, `UpdateObgynHistoryDto`, `PatientObgynHistoryDto` |
| `src/specialties/obgyn/patient-history/obgyn-history.service.ts` | Remove `husband_name`, add `menopause_history` + `blood_group_rh` |
| `src/builder/fields/allowed-paths.ts` | 14 new path entries |
| `prisma/seeds/obgyn-patient-history.ts` | Modify 2 sections, add 2 new sections, bump to v4 |