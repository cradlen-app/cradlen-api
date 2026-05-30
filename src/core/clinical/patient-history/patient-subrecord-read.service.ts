import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PatientAccessService } from './patient-access.service';

/**
 * Shared base for the read-only patient-history subrecord services
 * (allergies, contraceptives, non-gyn surgeries, medications, pregnancies).
 *
 * Each lists one soft-delete-filtered, patient-scoped collection after the
 * same org-access check, differing only in the Prisma delegate and the
 * `orderBy`. Writes happen via `PATCH /patients/:id/obgyn-history`, which owns
 * the singleton `version` token across the whole history surface — so these
 * services are read-only by design.
 *
 * `@Injectable()` on the base ensures TS emits constructor `design:paramtypes`;
 * subclasses inherit it (Nest's `Reflect.getMetadata` walks the prototype
 * chain), so they need no constructor of their own.
 */
@Injectable()
export abstract class PatientSubrecordReadService {
  constructor(
    protected readonly prismaService: PrismaService,
    protected readonly patientAccess: PatientAccessService,
  ) {}

  /** Assert the caller's org can see the patient, then run the fetch. */
  protected async read<T>(
    patientId: string,
    user: AuthContext,
    fetch: () => Promise<T>,
  ): Promise<T> {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return fetch();
  }
}
