import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientVisitsService } from './patient-visits.service.js';

describe('PatientVisitsService', () => {
  let service: PatientVisitsService;
  let findMany: jest.Mock;
  let count: jest.Mock;

  const guardianCtx: PatientAuthContext = {
    userId: 'u1',
    guardianId: 'g1',
    accessiblePatientIds: ['p1', 'p2'],
  };

  beforeEach(() => {
    findMany = jest.fn().mockReturnValue([]);
    count = jest.fn().mockReturnValue(0);
    const prisma = {
      db: {
        visit: { findMany, count },
        $transaction: (ops: unknown[]) => Promise.all(ops),
      },
    } as unknown as PrismaService;
    service = new PatientVisitsService(prisma);
  });

  it('throws 404 when a guardian targets an un-linked patient', async () => {
    await expect(
      service.listVisits(guardianCtx, { patient_id: 'p9', page: 1, limit: 10 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns an empty page without querying when no accessible patients', async () => {
    const result = await service.listVisits(
      { userId: 'u1', accessiblePatientIds: [] },
      { page: 1, limit: 10 },
    );
    expect(findMany).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
    expect(result.meta).toMatchObject({ page: 1, limit: 10, total: 0 });
  });

  it('filters to COMPLETED visits within the accessible patients, newest first', async () => {
    await service.listVisits(guardianCtx, { page: 2, limit: 10 });

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.where).toMatchObject({
      is_deleted: false,
      status: 'COMPLETED',
      episode: { journey: { patient_id: { in: ['p1', 'p2'] } } },
    });
    expect(arg.orderBy).toEqual({ completed_at: 'desc' });
    expect(arg.skip).toBe(10);
    expect(arg.take).toBe(10);
  });

  it('maps a visit row into the portal item shape', async () => {
    const scheduledAt = new Date('2026-01-01T09:00:00Z');
    const completedAt = new Date('2026-01-01T10:00:00Z');
    const row = {
      id: 'v1',
      scheduled_at: scheduledAt,
      completed_at: completedAt,
      appointment_type: 'VISIT',
      priority: 'NORMAL',
      status: 'COMPLETED',
      specialty_code: 'OBGYN',
      assigned_doctor: { user: { first_name: 'Aya', last_name: 'Hassan' } },
      branch: { name: 'Main Branch' },
      episode: { journey: { organization: { name: 'Jasmin Clinic' } } },
      diagnoses: [
        { code: 'N80.0', description: 'Endometriosis', is_primary: true },
      ],
      prescription: {
        items: [
          {
            medication: { name: 'Paracetamol' },
            custom_drug_name: null,
            dose: '500mg',
            frequency: 'TID',
            route: 'oral',
            duration: '5 days',
            instructions: 'after meals',
          },
          {
            medication: null,
            custom_drug_name: 'Herbal X',
            dose: '1 cap',
            frequency: 'OD',
            route: null,
            duration: null,
            instructions: null,
          },
        ],
      },
      investigations: [
        {
          lab_test: { name: 'CBC' },
          custom_test_name: null,
          status: 'RESULTED',
        },
        { lab_test: null, custom_test_name: '', status: 'ORDERED' }, // empty → filtered
      ],
    };
    findMany.mockReturnValue([row]);
    count.mockReturnValue(1);

    const result = await service.listVisits(
      { userId: 'u1', patientId: 'p1', accessiblePatientIds: ['p1'] },
      { page: 1, limit: 10 },
    );

    expect(result.meta).toMatchObject({
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
    const item = result.items[0];
    expect(item).toMatchObject({
      id: 'v1',
      visit_date: scheduledAt,
      completed_at: completedAt,
      appointment_type: 'VISIT',
      priority: 'NORMAL',
      status: 'COMPLETED',
      specialty_code: 'OBGYN',
      doctor_name: 'Dr. Aya Hassan',
      organization_name: 'Jasmin Clinic',
      branch_name: 'Main Branch',
    });
    expect(item.diagnoses).toEqual([
      { code: 'N80.0', description: 'Endometriosis', is_primary: true },
    ]);
    expect(item.medications).toEqual([
      {
        name: 'Paracetamol',
        dose: '500mg',
        frequency: 'TID',
        route: 'oral',
        duration: '5 days',
        instructions: 'after meals',
      },
      {
        name: 'Herbal X',
        dose: '1 cap',
        frequency: 'OD',
        route: null,
        duration: null,
        instructions: null,
      },
    ]);
    expect(item.investigations).toEqual([{ name: 'CBC', status: 'RESULTED' }]);
  });
});
