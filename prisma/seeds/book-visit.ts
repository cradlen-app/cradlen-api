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
  // Legacy cleanup: the pre-composition OB/GYN seed wrote a code='obgyn_book_visit'
  // row. With composition, that code is replaced by 'book_visit' + 'obgyn_book_visit_ext'.
  // Soft-delete the legacy row so listings/lookups can't surface it.
  await prisma.formTemplate.updateMany({
    where: { code: 'obgyn_book_visit', is_deleted: false },
    data: { is_deleted: true, deleted_at: new Date(), is_active: false },
  });

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
