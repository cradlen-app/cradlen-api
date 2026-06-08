import { NotFoundException } from '@nestjs/common';
import { PatientMedicationsService } from './patient-medications.service.js';
import { computeMedicationEndDate } from './medication-duration.util.js';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';

const DAY = 86_400_000;

function createEnv() {
  const findMany = jest.fn();
  const prisma = {
    db: { prescriptionItem: { findMany } },
  } as unknown as PrismaService;
  return { service: new PatientMedicationsService(prisma), findMany };
}

function patientCtx(ids: string[]): PatientAuthContext {
  return { userId: 'u1', patientId: ids[0], accessiblePatientIds: ids };
}

interface RowOverrides {
  id?: string;
  custom_drug_name?: string | null;
  medication?: Record<string, unknown> | null;
  duration?: string | null;
  prescribedAt?: Date;
}

function makeRow(o: RowOverrides = {}) {
  return {
    id: o.id ?? 'item-1',
    custom_drug_name: o.custom_drug_name ?? null,
    dose: '1 tab',
    route: 'oral',
    frequency: 'every 24h',
    duration: o.duration === undefined ? '1 month' : o.duration,
    instructions: 'after meals',
    medication:
      o.medication === undefined
        ? {
            name: 'Folic acid',
            generic_name: 'folic acid',
            strength: '5 mg',
            form: 'tablet',
            category: 'Supplement',
          }
        : o.medication,
    prescription: {
      prescribed_at: o.prescribedAt ?? new Date(Date.now() - 2 * DAY),
      prescribed_by: { user: { first_name: 'Sara', last_name: 'Mansour' } },
      visit: {
        scheduled_at: o.prescribedAt ?? new Date(Date.now() - 2 * DAY),
        branch: {
          name: 'Cradlen Maadi',
          organization: { name: 'Jasmin Clinic' },
        },
      },
    },
  };
}

describe('PatientMedicationsService', () => {
  it('returns an empty result without querying when no patients are accessible', async () => {
    const { service, findMany } = createEnv();
    const res = await service.listMedications(patientCtx([]));
    expect(res).toEqual({ current: [], past: [] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects a patient_id outside the accessible set (generic 404)', async () => {
    const { service, findMany } = createEnv();
    await expect(
      service.listMedications(patientCtx(['p1']), 'p2'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('splits CURRENT vs PAST by computed duration end date', async () => {
    const { service, findMany } = createEnv();
    findMany.mockResolvedValue([
      // recent + 1 month -> ends in the future -> current
      makeRow({ id: 'a', prescribedAt: new Date(Date.now() - 2 * DAY) }),
      // old + 7 days -> ended long ago -> past
      makeRow({
        id: 'b',
        duration: '7 days',
        prescribedAt: new Date(Date.now() - 400 * DAY),
      }),
      // no duration -> open-ended -> current
      makeRow({
        id: 'c',
        duration: null,
        prescribedAt: new Date(Date.now() - 400 * DAY),
      }),
    ]);

    const res = await service.listMedications(patientCtx(['p1']));

    expect(res.current.map((m) => m.id).sort()).toEqual(['a', 'c']);
    expect(res.past.map((m) => m.id)).toEqual(['b']);
    expect(res.current.find((m) => m.id === 'c')?.end_date).toBeNull();
  });

  it('maps catalog fields, doctor, and clinic', async () => {
    const { service, findMany } = createEnv();
    findMany.mockResolvedValue([makeRow({ id: 'a' })]);

    const { current } = await service.listMedications(patientCtx(['p1']));
    const item = current[0];

    expect(item).toMatchObject({
      name: 'Folic acid',
      category: 'Supplement',
      strength: '5 mg',
      form: 'tablet',
      dose: '1 tab',
      frequency: 'every 24h',
      instructions: 'after meals',
      doctor_name: 'Dr. Sara Mansour',
      clinic_name: 'Cradlen Maadi',
      organization_name: 'Jasmin Clinic',
    });
  });

  it('falls back to custom_drug_name with no category when not a catalog drug', async () => {
    const { service, findMany } = createEnv();
    findMany.mockResolvedValue([
      makeRow({ id: 'a', medication: null, custom_drug_name: 'Some Syrup' }),
    ]);

    const { current } = await service.listMedications(patientCtx(['p1']));
    expect(current[0].name).toBe('Some Syrup');
    expect(current[0].category).toBeNull();
  });

  it('scopes the query to the resolved patient id when one is supplied', async () => {
    const { service, findMany } = createEnv();
    findMany.mockResolvedValue([]);

    await service.listMedications(patientCtx(['p1', 'p2']), 'p2');

    const arg = findMany.mock.calls[0][0] as {
      where: {
        prescription: {
          visit: { episode: { journey: { patient_id: unknown } } };
        };
      };
    };
    expect(arg.where.prescription.visit.episode.journey.patient_id).toEqual({
      in: ['p2'],
    });
  });
});

describe('computeMedicationEndDate', () => {
  const start = new Date('2026-01-15T00:00:00.000Z');

  it('adds days/weeks/months/years', () => {
    expect(computeMedicationEndDate(start, '7 days')?.toISOString()).toBe(
      '2026-01-22T00:00:00.000Z',
    );
    expect(computeMedicationEndDate(start, '2 weeks')?.toISOString()).toBe(
      '2026-01-29T00:00:00.000Z',
    );
    expect(computeMedicationEndDate(start, '1 month')?.toISOString()).toBe(
      '2026-02-15T00:00:00.000Z',
    );
    expect(computeMedicationEndDate(start, '1 year')?.toISOString()).toBe(
      '2027-01-15T00:00:00.000Z',
    );
  });

  it('returns null for empty or unparseable durations', () => {
    expect(computeMedicationEndDate(start, null)).toBeNull();
    expect(computeMedicationEndDate(start, '')).toBeNull();
    expect(computeMedicationEndDate(start, 'as needed')).toBeNull();
    expect(computeMedicationEndDate(start, '0 days')).toBeNull();
  });
});
