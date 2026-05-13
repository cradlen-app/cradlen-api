# Book-Visit Template Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the `obgyn_book_visit` form template into a generic `book_visit` shell + a per-specialty `OBGYN` extension, served via `GET /v1/form-templates/book_visit?extension=OBGYN`. This is the foundation that lets a mixed-specialty clinic (OB/GYN + pediatrics + …) share one booking shell while each specialty contributes its own clinical fields.

**Architecture:** Add a parent-extension relationship on `FormTemplate` (`parent_template_id`, `extension_key`). Composition is **override + append hybrid**: an extension section whose `code` matches a shell section *replaces* the shell section at the shell's position; non-matching sections append in extension order. A SYSTEM-bound `specialty_code` field on the shell acts as the discriminator (parallel to the existing `visitor_type`). Versioning is **bundled activation** — one orchestrator seed activates shell + all extensions in a single Prisma `$transaction`. The endpoint accepts an optional `?extension=<KEY>` query; absent = raw shell.

**Tech Stack:** NestJS 11, Prisma 7 (Neon Postgres), TypeScript, Jest. Templates are code-managed via `prisma db seed` — there is no admin write path.

---

## File Map

**Create:**
- `prisma/migrations/<timestamp>_form_template_extensions/migration.sql` — schema + data migration
- `src/builder/templates/template-composition.service.ts` — pure composer
- `src/builder/templates/template-composition.service.spec.ts` — unit tests
- `prisma/seeds/book-visit-shell.ts` — generic shell seed
- `prisma/seeds/book-visit.ts` — orchestrator (shell + extensions, bundled activation)

**Modify:**
- `prisma/schema.prisma` — `FormTemplate` model gains `parent_template_id`, `extension_key`, self-relation
- `src/builder/fields/allowed-paths.ts` — add `specialty_code` to `SYSTEM`
- `src/builder/templates/templates.service.ts` — add `findActiveExtension`, `findActiveComposed`
- `src/builder/templates/templates.controller.ts` — accept `?extension=` query param
- `src/builder/templates/templates.module.ts` — register composer
- `prisma/seeds/obgyn-book-visit.ts` — rewrite as `OBGYN` extension (parent = shell)
- `prisma/seed.ts` — call `seedBookVisitTemplate` orchestrator (drop direct OB/GYN call)
- `src/builder/templates/templates.README.md` — document composition semantics

**Test:**
- `src/builder/templates/template-composition.service.spec.ts`
- `src/builder/templates/templates.controller.e2e-spec.ts` (extend existing or create)

---

### Task 1: Schema — parent/extension relationship on FormTemplate

**Files:**
- Modify: `prisma/schema.prisma:1548-1577`
- Create: `prisma/migrations/<timestamp>_form_template_extensions/migration.sql`

- [ ] **Step 1: Update `FormTemplate` model in `prisma/schema.prisma`**

Replace the existing `FormTemplate` model (lines 1548–1577) with:

```prisma
model FormTemplate {
  id                  String             @id @default(uuid()) @db.Uuid
  code                String
  name                String
  description         String?
  scope               FormScope
  version             Int                @default(1)
  status              FormTemplateStatus @default(DRAFT)
  published_at        DateTime?
  is_active           Boolean            @default(false)
  activated_at        DateTime?
  specialty_id        String?            @db.Uuid
  specialty           Specialty?         @relation(fields: [specialty_id], references: [id], onDelete: SetNull)
  parent_template_id  String?            @db.Uuid
  parent_template     FormTemplate?      @relation("FormTemplateExtensions", fields: [parent_template_id], references: [id], onDelete: Cascade)
  extensions          FormTemplate[]     @relation("FormTemplateExtensions")
  extension_key       String?
  created_by_id       String?            @db.Uuid
  created_by          Profile?           @relation("FormTemplateCreatedBy", fields: [created_by_id], references: [id], onDelete: SetNull)
  updated_by_id       String?            @db.Uuid
  updated_by          Profile?           @relation("FormTemplateUpdatedBy", fields: [updated_by_id], references: [id], onDelete: SetNull)
  is_deleted          Boolean            @default(false)
  deleted_at          DateTime?
  created_at          DateTime           @default(now())
  updated_at          DateTime           @updatedAt
  sections            FormSection[]

  @@unique([code, version])
  @@index([scope, status, is_deleted])
  @@index([parent_template_id, extension_key])
  // Partial unique "(code) WHERE is_active=true AND is_deleted=false AND parent_template_id IS NULL" — shells only.
  // Partial unique "(parent_template_id, extension_key) WHERE is_active=true AND is_deleted=false" — extensions only.
  // CHECK constraint: (parent_template_id IS NULL) = (extension_key IS NULL).
  // All added via raw-SQL in the migration.
  @@map("form_templates")
}
```

- [ ] **Step 2: Generate the migration SQL skeleton**

Run: `npx prisma migrate dev --create-only --name form_template_extensions`
Expected: a new `prisma/migrations/<timestamp>_form_template_extensions/migration.sql` created. Prisma generates ALTER TABLE statements adding the two new columns and FK.

- [ ] **Step 3: Edit the generated migration to drop the old `code`-only partial index, add the new partial indexes and CHECK constraint**

Append the following to the generated `migration.sql` (after the Prisma-generated ALTER TABLE):

```sql
-- Replace the old "active shell" partial unique with one scoped to parent_template_id IS NULL.
DROP INDEX IF EXISTS "form_templates_code_active_unique";
CREATE UNIQUE INDEX "form_templates_code_active_shell_unique"
  ON "form_templates" ("code")
  WHERE "is_active" = true AND "is_deleted" = false AND "parent_template_id" IS NULL;

-- One active extension per (parent, extension_key).
CREATE UNIQUE INDEX "form_templates_parent_ext_active_unique"
  ON "form_templates" ("parent_template_id", "extension_key")
  WHERE "is_active" = true AND "is_deleted" = false AND "parent_template_id" IS NOT NULL;

-- Symmetry constraint: extension rows must declare an extension_key; shell rows must not.
ALTER TABLE "form_templates"
  ADD CONSTRAINT "form_templates_extension_symmetry_check"
  CHECK ((parent_template_id IS NULL) = (extension_key IS NULL));
```

NOTE: confirm the actual name of the existing partial index first with `\d form_templates` in psql, or grep prior migrations under `prisma/migrations/` for `WHERE is_active`. Adjust the `DROP INDEX IF EXISTS` line if the existing name differs.

- [ ] **Step 4: Apply the migration and regenerate the client**

Run: `npx prisma migrate dev && npx prisma generate`
Expected: migration applies, client regenerated, no errors. `npx prisma migrate status` shows "Database schema is up to date".

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(builder): FormTemplate parent/extension relationship + bundled-activation indexes"
```

---

### Task 2: Add `specialty_code` to `SYSTEM` namespace

**Files:**
- Modify: `src/builder/fields/allowed-paths.ts:66`

- [ ] **Step 1: Add `specialty_code` to `SYSTEM`**

In `src/builder/fields/allowed-paths.ts`, change line 66 from:

```ts
  SYSTEM: ['visitor_type'],
```

to:

```ts
  SYSTEM: ['visitor_type', 'specialty_code'],
```

- [ ] **Step 2: Run the contract test to confirm nothing breaks**

Run: `npx jest src/builder/fields/allowed-paths.contract.spec.ts`
Expected: PASS. The contract test checks that DTO-mapped namespaces still align; `SYSTEM` is not DTO-mapped (it's flow-control only), so adding a path is non-breaking.

- [ ] **Step 3: Commit**

```bash
git add src/builder/fields/allowed-paths.ts
git commit -m "feat(builder): SYSTEM namespace gains specialty_code discriminator path"
```

---

### Task 3: `TemplateCompositionService` — pure compose function (TDD)

**Files:**
- Create: `src/builder/templates/template-composition.service.ts`
- Test: `src/builder/templates/template-composition.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/builder/templates/template-composition.service.spec.ts`:

```ts
import { TemplateCompositionService } from './template-composition.service.js';
import type { HydratableTemplate } from '../renderer/template-renderer.service.js';

function mkSection(code: string, order: number, fieldCodes: string[] = []) {
  return {
    id: `sec-${code}`,
    form_template_id: 'tpl-shell',
    code,
    name: code,
    order,
    config: {},
    is_deleted: false,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    fields: fieldCodes.map((fc, i) => ({
      id: `fld-${code}-${fc}`,
      section_id: `sec-${code}`,
      code: fc,
      label: fc,
      type: 'TEXT' as const,
      order: i,
      required: false,
      binding_namespace: null,
      binding_path: null,
      config: {},
      is_deleted: false,
      deleted_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    })),
  };
}

function mkTemplate(
  id: string,
  code: string,
  sections: ReturnType<typeof mkSection>[],
): HydratableTemplate {
  return {
    id,
    code,
    name: code,
    description: null,
    scope: 'BOOK_VISIT' as any,
    version: 1,
    status: 'PUBLISHED' as any,
    published_at: new Date(),
    is_active: true,
    activated_at: new Date(),
    specialty_id: null,
    parent_template_id: null,
    extension_key: null,
    created_by_id: null,
    updated_by_id: null,
    is_deleted: false,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    sections,
  };
}

describe('TemplateCompositionService', () => {
  const svc = new TemplateCompositionService();

  it('returns the shell unchanged when no extension is provided', () => {
    const shell = mkTemplate('s', 'book_visit', [
      mkSection('search', 0),
      mkSection('visit_metadata', 1),
    ]);
    const out = svc.compose(shell, null);
    expect(out.sections.map((s) => s.code)).toEqual(['search', 'visit_metadata']);
    expect(out).toBe(shell);
  });

  it('overrides a shell section when extension has the same code, keeping shell position', () => {
    const shell = mkTemplate('s', 'book_visit', [
      mkSection('search', 0, ['shell_a']),
      mkSection('clinical_info', 1, ['shell_b']),
      mkSection('vitals', 2, ['shell_c']),
    ]);
    const ext = mkTemplate('e', 'obgyn_ext', [
      mkSection('clinical_info', 0, ['ext_b']),
    ]);
    const out = svc.compose(shell, ext);
    expect(out.sections.map((s) => s.code)).toEqual([
      'search',
      'clinical_info',
      'vitals',
    ]);
    const clinical = out.sections.find((s) => s.code === 'clinical_info')!;
    expect(clinical.fields.map((f) => f.code)).toEqual(['ext_b']);
    expect(clinical.order).toBe(1);
  });

  it('appends extension sections whose codes do not exist in the shell', () => {
    const shell = mkTemplate('s', 'book_visit', [
      mkSection('search', 0),
      mkSection('visit_metadata', 1),
    ]);
    const ext = mkTemplate('e', 'obgyn_ext', [
      mkSection('obgyn_intake', 0),
      mkSection('obgyn_history', 1),
    ]);
    const out = svc.compose(shell, ext);
    expect(out.sections.map((s) => s.code)).toEqual([
      'search',
      'visit_metadata',
      'obgyn_intake',
      'obgyn_history',
    ]);
  });

  it('mixes override and append in one pass', () => {
    const shell = mkTemplate('s', 'book_visit', [
      mkSection('a', 0),
      mkSection('b', 1),
      mkSection('c', 2),
    ]);
    const ext = mkTemplate('e', 'obgyn_ext', [
      mkSection('b', 0, ['x']),
      mkSection('d', 1),
    ]);
    const out = svc.compose(shell, ext);
    expect(out.sections.map((s) => s.code)).toEqual(['a', 'b', 'c', 'd']);
    const b = out.sections.find((s) => s.code === 'b')!;
    expect(b.fields.map((f) => f.code)).toEqual(['x']);
  });

  it('reports composition metadata so the renderer can echo it', () => {
    const shell = mkTemplate('s', 'book_visit', [mkSection('a', 0)]);
    const ext = mkTemplate('e', 'obgyn_ext', [mkSection('a', 0)]);
    (ext as any).extension_key = 'OBGYN';
    const out = svc.compose(shell, ext);
    expect((out as any).composed_from).toEqual({
      shell_id: 's',
      extension_id: 'e',
      extension_key: 'OBGYN',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/builder/templates/template-composition.service.spec.ts`
Expected: FAIL — `Cannot find module './template-composition.service.js'`.

- [ ] **Step 3: Implement the composer**

Create `src/builder/templates/template-composition.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { HydratableTemplate } from '../renderer/template-renderer.service.js';

/**
 * Pure composer. Merge semantics: any extension section whose `code` matches
 * a shell section REPLACES the shell section at the shell's position (the
 * shell's order is preserved; the extension contributes content only).
 * Extension sections whose codes do not appear in the shell are APPENDED in
 * extension order after all shell sections.
 *
 * Field-level merging is intentionally out of scope — section is the merge unit.
 */
@Injectable()
export class TemplateCompositionService {
  compose(
    shell: HydratableTemplate,
    extension: HydratableTemplate | null,
  ): HydratableTemplate {
    if (!extension) return shell;

    const extBySectionCode = new Map(
      extension.sections.map((s) => [s.code, s]),
    );
    const usedExtCodes = new Set<string>();

    const mergedShellSections = shell.sections.map((shellSec) => {
      const override = extBySectionCode.get(shellSec.code);
      if (!override) return shellSec;
      usedExtCodes.add(shellSec.code);
      return { ...override, order: shellSec.order };
    });

    const appended = extension.sections
      .filter((s) => !usedExtCodes.has(s.code))
      .map((s, i) => ({ ...s, order: shell.sections.length + i }));

    const composed: HydratableTemplate = {
      ...shell,
      sections: [...mergedShellSections, ...appended],
    };

    (composed as any).composed_from = {
      shell_id: shell.id,
      extension_id: extension.id,
      extension_key: extension.extension_key,
    };

    return composed;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/builder/templates/template-composition.service.spec.ts`
Expected: PASS, all 5 specs green.

- [ ] **Step 5: Commit**

```bash
git add src/builder/templates/template-composition.service.ts src/builder/templates/template-composition.service.spec.ts
git commit -m "feat(builder): TemplateCompositionService — override+append merge"
```

---

### Task 4: TemplatesService — extension lookup + composed fetch

**Files:**
- Modify: `src/builder/templates/templates.service.ts`

- [ ] **Step 1: Add `findActiveExtension` and `findActiveComposed` to `TemplatesService`**

Replace the body of `src/builder/templates/templates.service.ts` with:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { HydratableTemplate } from '../renderer/template-renderer.service.js';
import { TemplateCompositionService } from './template-composition.service.js';

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly composer: TemplateCompositionService,
  ) {}

  async findActiveByCode(code: string): Promise<HydratableTemplate> {
    const row = await this.prismaService.db.formTemplate.findFirst({
      where: {
        code,
        is_active: true,
        is_deleted: false,
        parent_template_id: null,
      },
      include: { sections: { include: { fields: true } } },
    });
    if (!row) {
      throw new NotFoundException(
        `No active form template found for code "${code}"`,
      );
    }
    return row;
  }

  async findVersion(
    code: string,
    version: number,
  ): Promise<HydratableTemplate> {
    const row = await this.prismaService.db.formTemplate.findFirst({
      where: { code, version, is_deleted: false },
      include: { sections: { include: { fields: true } } },
    });
    if (!row) {
      throw new NotFoundException(
        `No form template found for code "${code}" version ${version}`,
      );
    }
    return row;
  }

  async findActiveExtension(
    parentTemplateId: string,
    extensionKey: string,
  ): Promise<HydratableTemplate> {
    const row = await this.prismaService.db.formTemplate.findFirst({
      where: {
        parent_template_id: parentTemplateId,
        extension_key: extensionKey,
        is_active: true,
        is_deleted: false,
      },
      include: { sections: { include: { fields: true } } },
    });
    if (!row) {
      throw new NotFoundException(
        `No active extension "${extensionKey}" found for parent template ${parentTemplateId}`,
      );
    }
    return row;
  }

  async findActiveComposed(
    code: string,
    extensionKey: string | null,
  ): Promise<HydratableTemplate> {
    const shell = await this.findActiveByCode(code);
    if (!extensionKey) return shell;
    const extension = await this.findActiveExtension(shell.id, extensionKey);
    return this.composer.compose(shell, extension);
  }

  listActive() {
    return this.prismaService.db.formTemplate.findMany({
      where: {
        is_active: true,
        is_deleted: false,
        status: 'PUBLISHED',
        parent_template_id: null,
      },
      orderBy: [{ scope: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        scope: true,
        version: true,
        specialty_id: true,
        activated_at: true,
      },
    });
  }
}
```

KEY CHANGES vs current file:
- `findActiveByCode` now filters `parent_template_id: null` (shells only).
- `listActive` filters `parent_template_id: null` (extensions are not standalone listings).
- New `findActiveExtension(parentId, key)` and `findActiveComposed(code, key|null)`.
- Constructor takes `TemplateCompositionService`.

- [ ] **Step 2: Register `TemplateCompositionService` in `TemplatesModule`**

Open `src/builder/templates/templates.module.ts`, add `TemplateCompositionService` to the `providers` array (import from `./template-composition.service.js`). Do NOT add it to `exports` unless another module needs it.

- [ ] **Step 3: Run the existing templates tests + the new composer test to confirm nothing regressed**

Run: `npx jest src/builder/templates/`
Expected: all PASS. (Composer spec from Task 3 still green; if controller/service spec existed, it still green.)

- [ ] **Step 4: Type-check the whole project**

Run: `npm run build`
Expected: webpack build succeeds, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/builder/templates/templates.service.ts src/builder/templates/templates.module.ts
git commit -m "feat(builder): TemplatesService extension lookups + composed fetch"
```

---

### Task 5: Controller accepts `?extension=` query param

**Files:**
- Modify: `src/builder/templates/templates.controller.ts`

- [ ] **Step 1: Update the controller to accept the optional `extension` query**

Replace `src/builder/templates/templates.controller.ts` with:

```ts
import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiTags, ApiQuery } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import { TemplatesService } from './templates.service.js';
import { TemplateRendererService } from '../renderer/template-renderer.service.js';
import {
  FormTemplateDto,
  FormTemplateSummaryDto,
} from './dto/form-template.dto.js';

@ApiTags('form-templates')
@Controller({ path: 'form-templates', version: '1' })
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly renderer: TemplateRendererService,
  ) {}

  @Get()
  @ApiStandardResponse(FormTemplateSummaryDto)
  async list() {
    return this.templates.listActive();
  }

  @Get(':code')
  @ApiStandardResponse(FormTemplateDto)
  @ApiQuery({
    name: 'extension',
    required: false,
    description:
      'Optional extension key (e.g. "OBGYN"). When provided, the response is the shell template composed with the active extension matching this key.',
  })
  async getActive(
    @Param('code') code: string,
    @Query('extension') extension?: string,
  ) {
    const row = await this.templates.findActiveComposed(
      code,
      extension ?? null,
    );
    return this.renderer.render(row);
  }

  @Get(':code/versions/:version')
  @ApiStandardResponse(FormTemplateDto)
  async getVersion(
    @Param('code') code: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    const row = await this.templates.findVersion(code, version);
    return this.renderer.render(row);
  }
}
```

- [ ] **Step 2: Run lint + build**

Run: `npm run lint && npm run build`
Expected: both succeed, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/builder/templates/templates.controller.ts
git commit -m "feat(builder): form-templates :code endpoint accepts ?extension= query"
```

---

### Task 6: Shell seed — generic `book_visit`

**Files:**
- Create: `prisma/seeds/book-visit-shell.ts`

- [ ] **Step 1: Create the shell seed**

Create `prisma/seeds/book-visit-shell.ts`. This file is structurally identical to the existing `obgyn-book-visit.ts` (reuse its `FieldSpec`, `SectionSpec`, `emitAutoForbiddenPredicates`, `assertAllValid`, `buildSectionConfig` helpers — copy them verbatim into this file, since they're internal to the seed module). The differences from the original:

1. `TEMPLATE_CODE = 'book_visit'`, `TEMPLATE_VERSION = 1`, `specialty_id = null` (this is generic).
2. Add a new `specialty_code` SELECT field at the top of `visit_metadata`, SYSTEM-bound, declared as a discriminator (parallel to `visitor_type`).
3. Keep ONLY the shell-generic sections: `search`, `visit_metadata` (with the new `specialty_code` field added), `patient_info`, `vitals`, `medical_rep_info`.
4. Drop the OB/GYN-flavored `clinical_info` section (those options move into the extension).
5. The function signature is `export async function seedBookVisitShell(prisma): Promise<FormTemplate>` — it returns the upserted shell row so the orchestrator can pass its `id` to the extension seed. **Crucially, this function does NOT run an activation transaction** — activation is bundled in the orchestrator (Task 8).

Concretely, the new `specialty_code` field — add as the FIRST field inside the `visit_metadata` section:

```ts
{
  code: 'specialty_code',
  label: 'Specialty',
  type: 'SELECT',
  required: true,
  binding: { namespace: 'SYSTEM', path: 'specialty_code' },
  config: {
    validation: {
      options: [
        { code: 'OBGYN', label: 'OB/GYN' },
        // Future specialties append here as their extensions are authored.
      ],
    },
    logic: {
      is_discriminator: true,
      predicates: [
        { effect: 'visible', when: { eq: { visitor_type: 'PATIENT' } } },
        { effect: 'required', when: { eq: { visitor_type: 'PATIENT' } } },
      ],
    },
  },
},
```

The upsert at the end of the function:

```ts
const template = await prisma.formTemplate.upsert({
  where: { code_version: { code: TEMPLATE_CODE, version: TEMPLATE_VERSION } },
  update: {
    name: 'Book Visit (shell)',
    description:
      'Generic booking shell — handles visitor_type (PATIENT / MEDICAL_REP) and the specialty_code discriminator that selects which extension provides clinical fields.',
    scope: 'BOOK_VISIT',
    specialty_id: null,
    parent_template_id: null,
    extension_key: null,
  },
  create: {
    code: TEMPLATE_CODE,
    version: TEMPLATE_VERSION,
    name: 'Book Visit (shell)',
    description:
      'Generic booking shell — handles visitor_type (PATIENT / MEDICAL_REP) and the specialty_code discriminator that selects which extension provides clinical fields.',
    scope: 'BOOK_VISIT',
    status: 'DRAFT',
    specialty_id: null,
    parent_template_id: null,
    extension_key: null,
  },
});
```

Then the section/field upserts (identical pattern to the OB/GYN seed). Return `template` at the end. NO activation flip in this function.

- [ ] **Step 2: Run the contract test to confirm bindings are legal**

Run: `npx jest src/builder/fields/allowed-paths.contract.spec.ts`
Expected: PASS. The new `specialty_code` SYSTEM path was added in Task 2.

- [ ] **Step 3: Commit**

```bash
git add prisma/seeds/book-visit-shell.ts
git commit -m "feat(builder): book_visit shell seed — generic sections + specialty_code discriminator"
```

---

### Task 7: Rewrite `obgyn-book-visit.ts` as an extension

**Files:**
- Modify: `prisma/seeds/obgyn-book-visit.ts`

- [ ] **Step 1: Rewrite the file as an extension seed**

Replace the entire file with a seed that:

1. Changes `TEMPLATE_CODE` to `obgyn_book_visit_ext` (extension code is still unique, but lookup is by `(parent_id, extension_key)`).
2. Defines ONLY OB/GYN-specific sections. For the v1 cut, contribute one section: `clinical_info` (overrides the shell — but the shell no longer has `clinical_info`, so this effectively appends). Section content = the existing OB/GYN `clinical_info` (chief_complaint_categories with the OB/GYN option list, severity, duration, onset, notes). Keep the `visibleWhen / exclusivityKey` keyed on `visitor_type=PATIENT` so the section auto-hides for medical-rep visits.
3. Also add a `forbidden when specialty_code != 'OBGYN'` predicate to every field, auto-emitted by extending `emitAutoForbiddenPredicates` with a new top-level rule: every field in an EXTENSION seed is forbidden when `specialty_code` is anything other than `'OBGYN'`. The shell's `forbidden` machinery already handles `visitor_type` exclusivity; this layer adds specialty exclusivity.
4. The function signature changes to `export async function seedObgynBookVisitExtension(prisma, parentTemplate): Promise<FormTemplate>` — accepts the shell row (so it can fill `parent_template_id`). Returns the extension row. No activation flip.

The upsert:

```ts
const extension = await prisma.formTemplate.upsert({
  where: { code_version: { code: TEMPLATE_CODE, version: TEMPLATE_VERSION } },
  update: {
    name: 'OB/GYN Book Visit Extension',
    description:
      'OB/GYN-specific clinical intake for the book_visit shell. Activates when specialty_code=OBGYN.',
    scope: 'BOOK_VISIT',
    specialty_id: gynSpecialty?.id ?? null,
    parent_template_id: parentTemplate.id,
    extension_key: 'OBGYN',
  },
  create: {
    code: TEMPLATE_CODE,
    version: TEMPLATE_VERSION,
    name: 'OB/GYN Book Visit Extension',
    description:
      'OB/GYN-specific clinical intake for the book_visit shell. Activates when specialty_code=OBGYN.',
    scope: 'BOOK_VISIT',
    status: 'DRAFT',
    specialty_id: gynSpecialty?.id ?? null,
    parent_template_id: parentTemplate.id,
    extension_key: 'OBGYN',
  },
});
```

The specialty-exclusivity predicate emitter — add as a new helper inside the file:

```ts
/**
 * Every field in an extension is forbidden when the specialty_code
 * discriminator says a different specialty. Auto-emitted so individual
 * fields don't need to repeat the predicate.
 */
function emitSpecialtyExclusivity(extensionKey: string): void {
  for (const section of SECTIONS) {
    for (const f of section.fields) {
      const cfg = (f.config ??= {});
      const logic = (cfg.logic ??= {});
      const preds: Predicate[] = (logic.predicates ??= []);
      preds.push({
        effect: 'forbidden',
        when: { ne: { specialty_code: extensionKey } },
        message: `${f.code} is only allowed when specialty_code is ${extensionKey}`,
      });
    }
  }
}
```

NOTE on the predicate operator: the rules engine supports `eq | ne | in | and | or` per CLAUDE.md ("Form-builder DSL"). `ne` is the right operator here. If the runtime currently only implements a subset, fall back to `{ and: [...non-matching values...] }` enumerated explicitly using `eq` — verify by reading `src/builder/rules/predicates.ts` before writing this helper.

Call order at the top of the exported seed function: `emitSpecialtyExclusivity('OBGYN'); emitAutoForbiddenPredicates(); assertAllValid();`

- [ ] **Step 2: Confirm bindings still validate**

Run: `npx jest src/builder/fields/allowed-paths.contract.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add prisma/seeds/obgyn-book-visit.ts
git commit -m "feat(builder): rewrite OB/GYN book-visit seed as an extension of the book_visit shell"
```

---

### Task 8: Orchestrator — bundled activation

**Files:**
- Create: `prisma/seeds/book-visit.ts`
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Create the orchestrator**

Create `prisma/seeds/book-visit.ts`:

```ts
/**
 * Book-visit template orchestrator.
 *
 * Bundled activation: the shell + every known extension are upserted as
 * DRAFTs, then a single $transaction flips them all to active and
 * deactivates their prior versions. There is no intermediate state where
 * a shell is active without its extensions, or vice versa.
 */

import { PrismaClient } from '@prisma/client';
import { seedBookVisitShell } from './book-visit-shell.js';
import { seedObgynBookVisitExtension } from './obgyn-book-visit.js';

export async function seedBookVisitTemplate(prisma: PrismaClient) {
  const shell = await seedBookVisitShell(prisma);
  const obgynExt = await seedObgynBookVisitExtension(prisma, shell);

  await prisma.$transaction([
    // Deactivate prior active shells with the same code.
    prisma.formTemplate.updateMany({
      where: {
        code: shell.code,
        parent_template_id: null,
        is_active: true,
        id: { not: shell.id },
      },
      data: { is_active: false },
    }),
    // Deactivate prior active extensions for the same (parent, key).
    prisma.formTemplate.updateMany({
      where: {
        parent_template_id: shell.id,
        extension_key: 'OBGYN',
        is_active: true,
        id: { not: obgynExt.id },
      },
      data: { is_active: false },
    }),
    // Activate shell.
    prisma.formTemplate.update({
      where: { id: shell.id },
      data: {
        is_active: true,
        activated_at: shell.activated_at ?? new Date(),
        status: 'PUBLISHED',
        published_at: shell.published_at ?? new Date(),
      },
    }),
    // Activate OB/GYN extension.
    prisma.formTemplate.update({
      where: { id: obgynExt.id },
      data: {
        is_active: true,
        activated_at: obgynExt.activated_at ?? new Date(),
        status: 'PUBLISHED',
        published_at: obgynExt.published_at ?? new Date(),
      },
    }),
  ]);

  console.log(
    `Seeded book_visit shell + extensions [OBGYN] (bundled activation).`,
  );
}
```

- [ ] **Step 2: Replace the old OB/GYN call in `prisma/seed.ts` with the orchestrator**

Open `prisma/seed.ts`. Find the existing `import { seedObgynBookVisitTemplate } from './seeds/obgyn-book-visit.js'` and its call site. Replace with:

```ts
import { seedBookVisitTemplate } from './seeds/book-visit.js';
// ...
await seedBookVisitTemplate(prisma);
```

Remove the now-dead old import.

- [ ] **Step 3: Drop the old `obgyn_book_visit` row from the DB before re-seeding**

The previous seed wrote a `(code='obgyn_book_visit', version=1)` row. The new seed writes `code='obgyn_book_visit_ext'` instead, so the old row would linger as inactive forever and the `book_visit` shell would have no name collision. Add a one-shot cleanup at the top of the orchestrator (only fires if the legacy row exists):

```ts
// Legacy cleanup: the pre-composition OB/GYN seed wrote a code='obgyn_book_visit'
// row. With composition, that code is replaced by 'book_visit' + 'obgyn_book_visit_ext'.
// Soft-delete the legacy row so listings/lookups can't surface it.
await prisma.formTemplate.updateMany({
  where: { code: 'obgyn_book_visit', is_deleted: false },
  data: { is_deleted: true, deleted_at: new Date(), is_active: false },
});
```

Place this BEFORE the `seedBookVisitShell` call.

- [ ] **Step 4: Run the seed against a clean dev database**

Run: `npx prisma migrate reset --force && npx prisma db seed`
Expected: seed completes, prints "Seeded book_visit shell + extensions [OBGYN] (bundled activation)." No errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/seeds/book-visit.ts prisma/seed.ts prisma/seeds/obgyn-book-visit.ts
git commit -m "feat(builder): bundled-activation orchestrator for book_visit shell + OBGYN extension"
```

---

### Task 9: Smoke test the endpoint

**Files:**
- (None — verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run start:dev`
Expected: server boots on `PORT` from `.env` (default 3000), logs "Nest application successfully started".

- [ ] **Step 2: Fetch the shell only**

Run (in a separate terminal): `curl -s http://localhost:3000/v1/form-templates/book_visit | head -c 2000`
Expected: JSON `{ "data": { "code": "book_visit", "sections": [ { "code": "search", ... }, { "code": "visit_metadata", ... }, ... ] } }` — five sections (`search`, `visit_metadata`, `patient_info`, `vitals`, `medical_rep_info`). The `visit_metadata` section's fields include `specialty_code` first.

- [ ] **Step 3: Fetch the composed shell + OBGYN extension**

Run: `curl -s "http://localhost:3000/v1/form-templates/book_visit?extension=OBGYN" | head -c 3000`
Expected: same JSON shape but with an additional `clinical_info` section (the OB/GYN one), inserted after `vitals` (appended — shell has no `clinical_info` to override). Response also contains `composed_from: { shell_id, extension_id, extension_key: "OBGYN" }`. NOTE: the renderer currently doesn't pass `composed_from` through — if it's missing here, that's an indicator the renderer needs a small follow-up. Verify by inspecting `template-renderer.service.ts:32-46`; if absent, decide whether to extend the renderer to propagate it (1-line addition under the `return` object). This is the only known follow-up that may surface during smoke.

- [ ] **Step 4: Fetch a non-existent extension to confirm 404**

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/v1/form-templates/book_visit?extension=NONEXISTENT"`
Expected: `404`.

- [ ] **Step 5: Stop the dev server. No commit (verification only).**

---

### Task 10: Document composition in `templates.README.md`

**Files:**
- Modify: `src/builder/templates/templates.README.md`

- [ ] **Step 1: Append a "Composition" section to the README**

Add the following section to `src/builder/templates/templates.README.md`:

```markdown
## Composition (shell + extension)

A template can declare a `parent_template_id` and `extension_key`, making it an **extension** of another template (the **shell**). The endpoint `GET /v1/form-templates/:code?extension=<KEY>` returns the shell composed with the active extension matching that key under that shell. Without `?extension=`, the raw shell is returned.

**Merge rule (override + append hybrid):**
- An extension section whose `code` matches a shell section REPLACES the shell section at the shell's position. The shell's `order` is preserved; the extension contributes content only.
- An extension section whose `code` does not appear in the shell is APPENDED in extension declaration order after all shell sections.
- Field-level merging is not supported — section is the merge unit.

**Discriminator:** the shell carries a SYSTEM-bound `specialty_code` field (parallel to the existing `visitor_type`). Extensions auto-emit a `forbidden when specialty_code != <key>` predicate on every contained field, so the server rejects extension fields submitted under the wrong specialty even if the client sends them.

**Versioning (bundled activation):** the orchestrator seed for a shell + its known extensions performs activation in a single `$transaction` — there is no intermediate state where a shell is active without its extensions. Adding a new extension version means re-seeding the bundle.

**Listing:** `GET /v1/form-templates` returns only shells (rows with `parent_template_id IS NULL`). Extensions are not standalone listings.

**Lookup invariants:**
- Active shell: `WHERE code=? AND is_active AND NOT is_deleted AND parent_template_id IS NULL`.
- Active extension: `WHERE parent_template_id=? AND extension_key=? AND is_active AND NOT is_deleted`.
- DB enforces both via partial unique indexes; the symmetry CHECK guarantees `(parent_template_id IS NULL) = (extension_key IS NULL)`.
```

- [ ] **Step 2: Commit**

```bash
git add src/builder/templates/templates.README.md
git commit -m "docs(builder): document shell+extension composition semantics"
```

---

## Self-Review Notes

**Spec coverage:** all four locked decisions (override+append, specialty_code discriminator, single composed endpoint, bundled activation) have dedicated tasks. The migration (Task 1) creates the schema dimension; composition logic (Task 3) implements the merge; the endpoint (Task 5) exposes it; seeds (Tasks 6–8) prove it end-to-end; smoke (Task 9) verifies live.

**Out of scope (deliberate deferrals):**
1. `TemplateValidator` integration — the validator is not currently wired into book endpoints (per CLAUDE.md). Composition produces a `HydratableTemplate`; when the validator is wired in later, it will walk the composed tree without further changes.
2. Field-level overrides within a shared section — section is the merge unit.
3. Per-org overrides of templates — `organization_id` is not added to `FormTemplate` here. If/when needed, that's a separate dimension orthogonal to extensions.
4. FE coordination — the FE must switch from `GET /form-templates/obgyn_book_visit` to `GET /form-templates/book_visit?extension=OBGYN` plus auto-fill `specialty_code` from the selected doctor's specialty. Coordinate cutover with the web repo.

**Known follow-up (flagged in Task 9 Step 3):** `TemplateRendererService.render` does not currently propagate the `composed_from` metadata attached by the composer. If the smoke test reveals it's missing in the response and you want it surfaced, extend `RenderedTemplate` with an optional `composed_from?: { shell_id; extension_id; extension_key }` and pass it through in `render()`.
