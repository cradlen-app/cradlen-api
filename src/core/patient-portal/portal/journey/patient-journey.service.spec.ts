import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientJourneyService } from './patient-journey.service.js';

describe('PatientJourneyService', () => {
  let service: PatientJourneyService;
  let findFirst: jest.Mock;

  const guardianCtx: PatientAuthContext = {
    accountId: 'u1',
    guardianId: 'g1',
    accessiblePatientIds: ['p1', 'p2'],
  };

  beforeEach(() => {
    findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      db: { patientJourney: { findFirst } },
    } as unknown as PrismaService;
    service = new PatientJourneyService(prisma);
  });

  it('throws 404 when a guardian targets an un-linked patient', async () => {
    await expect(
      service.getActiveJourney(guardianCtx, { patient_id: 'p9' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('returns null when the caller has no accessible patients', async () => {
    const result = await service.getActiveJourney(
      { accountId: 'u1', accessiblePatientIds: [] },
      {},
    );
    expect(findFirst).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('queries the active journey scoped to accessible patients, newest first', async () => {
    await service.getActiveJourney(guardianCtx, {});
    const arg = findFirst.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.where).toMatchObject({
      is_deleted: false,
      status: 'ACTIVE',
      patient_id: { in: ['p1', 'p2'] },
    });
    expect(arg.orderBy).toEqual({ started_at: 'desc' });
  });

  it('returns null when there is no active journey', async () => {
    findFirst.mockResolvedValue(null);
    expect(await service.getActiveJourney(guardianCtx, {})).toBeNull();
  });

  it('derives DONE/CURRENT/UPCOMING from episode status and maps stages in order', async () => {
    findFirst.mockResolvedValue({
      id: 'j1',
      status: 'ACTIVE',
      started_at: new Date('2026-05-01T00:00:00Z'),
      care_path: {
        code: 'OBGYN_PREGNANCY',
        name: 'Pregnancy',
        specialty: { code: 'OBGYN' },
      },
      episodes: [
        { id: 'e1', name: 'Booking', order: 0, status: 'COMPLETED' },
        { id: 'e2', name: 'First Trimester', order: 1, status: 'ACTIVE' },
        { id: 'e3', name: 'Delivery', order: 2, status: 'PENDING' },
      ],
      pregnancy_record: null,
    });

    const dto = await service.getActiveJourney(guardianCtx, {});
    expect(dto).not.toBeNull();
    expect(dto!.care_path_code).toBe('OBGYN_PREGNANCY');
    expect(dto!.specialty_code).toBe('OBGYN');
    expect(dto!.label).toBe('Pregnancy');
    expect(dto!.pregnancy).toBeNull();
    expect(dto!.stages).toEqual([
      { id: 'e1', name: 'Booking', order: 0, status: 'DONE' },
      { id: 'e2', name: 'First Trimester', order: 1, status: 'CURRENT' },
      { id: 'e3', name: 'Delivery', order: 2, status: 'UPCOMING' },
    ]);
  });

  it('includes the pregnancy block with computed GA when a record exists', async () => {
    findFirst.mockResolvedValue({
      id: 'j1',
      status: 'ACTIVE',
      started_at: new Date('2026-05-01T00:00:00Z'),
      care_path: {
        code: 'OBGYN_PREGNANCY',
        name: 'Pregnancy',
        specialty: { code: 'OBGYN' },
      },
      episodes: [],
      pregnancy_record: {
        lmp: null,
        us_dating_date: null,
        us_ga_weeks: null,
        us_ga_days: null,
        number_of_fetuses: 2,
        pregnancy_type: 'twin',
        gender: 'Boy & Girl',
        risk_level: 'high',
      },
    });

    const dto = await service.getActiveJourney(guardianCtx, {});
    expect(dto!.pregnancy).toMatchObject({
      number_of_fetuses: 2,
      pregnancy_type: 'twin',
      fetal_sexes: 'Boy & Girl',
      risk_level: 'high',
      gestational_age_weeks: null,
      estimated_due_date: null,
    });
  });

  it('handles a non-pregnancy journey with no care path', async () => {
    findFirst.mockResolvedValue({
      id: 'j2',
      status: 'ACTIVE',
      started_at: new Date('2026-05-01T00:00:00Z'),
      care_path: null,
      episodes: [{ id: 'e1', name: 'Intake', order: 0, status: 'ACTIVE' }],
      pregnancy_record: null,
    });

    const dto = await service.getActiveJourney(guardianCtx, {});
    expect(dto!.care_path_code).toBeNull();
    expect(dto!.specialty_code).toBeNull();
    expect(dto!.label).toBeNull();
    expect(dto!.pregnancy).toBeNull();
    expect(dto!.stages[0].status).toBe('CURRENT');
  });
});
