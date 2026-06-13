import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_PRESCRIPTION_LAYOUT,
  DEFAULT_PRESCRIPTION_TEMPLATE_NAME,
} from '../../src/core/clinical/prescriptions/prescription-template.constants.js';

/**
 * Seeds the single global default prescription layout (organization/branch/
 * profile null, is_system = true). findFirst + create/update because the scope
 * columns are nullable and Postgres treats NULLs as distinct, so .upsert()
 * can't match the system row.
 */
export async function seedPrescriptionDefaultTemplate(prisma: PrismaClient) {
  const existing = await prisma.prescriptionTemplate.findFirst({
    where: {
      is_system: true,
      organization_id: null,
      branch_id: null,
      profile_id: null,
    },
  });

  const data = {
    name: DEFAULT_PRESCRIPTION_TEMPLATE_NAME,
    is_system: true,
    layout: DEFAULT_PRESCRIPTION_LAYOUT,
  };

  if (!existing) {
    await prisma.prescriptionTemplate.create({ data });
  } else {
    await prisma.prescriptionTemplate.update({
      where: { id: existing.id },
      data,
    });
  }
}
