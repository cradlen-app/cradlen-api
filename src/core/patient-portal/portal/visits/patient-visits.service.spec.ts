import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientVisitsService } from './patient-visits.service.js';

describe('PatientVisitsService', () => {
  let service: PatientVisitsService;
  let findMany: jest.Mock;
  let count: jest.Mock;
  let journeyFindMany: jest.Mock;
  let journeyCount: jest.Mock;

  const guardianCtx: PatientAuthContext = {
    accountId: 'u1',
    guardianId: 'g1',
    accessiblePatientIds: ['p1', 'p2'],
  };

  beforeEach(() => {
    findMany = jest.fn().mockReturnValue([]);
    count = jest.fn().mockReturnValue(0);
    journeyFindMany = jest.fn().mockReturnValue([]);
    journeyCount = jest.fn().mockReturnValue(0);
    const prisma = {
      db: {
        visit: { findMany, count },
        patientJourney: { findMany: journeyFindMany, count: journeyCount },
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
      { accountId: 'u1', accessiblePatientIds: [] },
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
      { accountId: 'u1', patientId: 'p1', accessiblePatientIds: ['p1'] },
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

  describe('listUpcoming', () => {
    it('throws 404 when a guardian targets an un-linked patient', async () => {
      await expect(
        service.listUpcoming(guardianCtx, {
          patient_id: 'p9',
          page: 1,
          limit: 10,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('returns an empty page without querying when no accessible patients', async () => {
      const result = await service.listUpcoming(
        { accountId: 'u1', accessiblePatientIds: [] },
        { page: 1, limit: 10 },
      );
      expect(findMany).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
      expect(result.meta).toMatchObject({ page: 1, limit: 10, total: 0 });
    });

    it('filters to future follow-ups on COMPLETED visits, soonest first', async () => {
      await service.listUpcoming(guardianCtx, { page: 2, limit: 10 });

      expect(findMany).toHaveBeenCalledTimes(1);
      const arg = findMany.mock.calls[0][0] as Record<string, unknown>;
      const where = arg.where as Record<string, unknown>;
      expect(where).toMatchObject({
        is_deleted: false,
        status: 'COMPLETED',
        episode: { journey: { patient_id: { in: ['p1', 'p2'] } } },
      });
      expect((where.follow_up_date as { gte: Date }).gte).toBeInstanceOf(Date);
      expect(arg.orderBy).toEqual({ follow_up_date: 'asc' });
      expect(arg.skip).toBe(10);
      expect(arg.take).toBe(10);
    });

    it('maps a row into the upcoming follow-up shape', async () => {
      const scheduledAt = new Date('2026-01-01T09:00:00Z');
      const followUpDate = new Date('2026-07-01T00:00:00Z');
      const row = {
        id: 'v1',
        scheduled_at: scheduledAt,
        follow_up_date: followUpDate,
        follow_up_notes: 'Recheck in 6 months',
        specialty_code: 'OBGYN',
        assigned_doctor: { user: { first_name: 'Aya', last_name: 'Hassan' } },
        branch: { name: 'Main Branch' },
        episode: { journey: { organization: { name: 'Jasmin Clinic' } } },
      };
      findMany.mockReturnValue([row]);
      count.mockReturnValue(1);

      const result = await service.listUpcoming(
        { accountId: 'u1', patientId: 'p1', accessiblePatientIds: ['p1'] },
        { page: 1, limit: 10 },
      );

      expect(result.meta).toMatchObject({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      expect(result.items[0]).toEqual({
        id: 'v1',
        follow_up_date: followUpDate,
        follow_up_notes: 'Recheck in 6 months',
        source_visit_date: scheduledAt,
        specialty_code: 'OBGYN',
        doctor_name: 'Dr. Aya Hassan',
        organization_name: 'Jasmin Clinic',
        branch_name: 'Main Branch',
      });
    });
  });

  describe('listJourneyTimeline', () => {
    it('throws 404 when a guardian targets an un-linked patient', async () => {
      await expect(
        service.listJourneyTimeline(guardianCtx, {
          patient_id: 'p9',
          page: 1,
          limit: 5,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(journeyFindMany).not.toHaveBeenCalled();
    });

    it('returns an empty page without querying when no accessible patients', async () => {
      const result = await service.listJourneyTimeline(
        { accountId: 'u1', accessiblePatientIds: [] },
        { page: 1, limit: 5 },
      );
      expect(journeyFindMany).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
      expect(result.meta).toMatchObject({ page: 1, limit: 5, total: 0 });
    });

    it('queries journeys for the accessible patients, newest first, paginated by journey', async () => {
      await service.listJourneyTimeline(guardianCtx, { page: 2, limit: 5 });

      expect(journeyFindMany).toHaveBeenCalledTimes(1);
      const arg = journeyFindMany.mock.calls[0][0] as Record<string, unknown>;
      expect(arg.where).toMatchObject({
        is_deleted: false,
        patient_id: { in: ['p1', 'p2'] },
      });
      // Cross-org: no organization_id / assigned-doctor filter.
      expect(arg.where).not.toHaveProperty('organization_id');
      expect(arg.orderBy).toEqual({ started_at: 'desc' });
      expect(arg.skip).toBe(5);
      expect(arg.take).toBe(5);
    });

    it('maps the journey → episode → visit tree, reusing the rich visit shape', async () => {
      const startedAt = new Date('2026-01-01T00:00:00Z');
      const completedAt = new Date('2026-02-01T10:00:00Z');
      const journeyRow = {
        id: 'j1',
        status: 'ACTIVE',
        started_at: startedAt,
        ended_at: null,
        journey_template: { name: 'Pregnancy', type: 'OBGYN_PREGNANCY' },
        episodes: [
          {
            id: 'e1',
            name: 'First trimester',
            order: 1,
            status: 'COMPLETED',
            started_at: startedAt,
            ended_at: null,
            visits: [
              {
                id: 'v1',
                scheduled_at: startedAt,
                completed_at: completedAt,
                appointment_type: 'VISIT',
                priority: 'NORMAL',
                status: 'COMPLETED',
                specialty_code: 'OBGYN',
                assigned_doctor: {
                  user: { first_name: 'Aya', last_name: 'Hassan' },
                },
                branch: { name: 'Main Branch' },
                episode: {
                  journey: { organization: { name: 'Jasmin Clinic' } },
                },
                diagnoses: [],
                prescription: { items: [] },
                investigations: [],
              },
            ],
          },
        ],
      };
      journeyFindMany.mockReturnValue([journeyRow]);
      journeyCount.mockReturnValue(1);

      const result = await service.listJourneyTimeline(
        { accountId: 'u1', patientId: 'p1', accessiblePatientIds: ['p1'] },
        { page: 1, limit: 5 },
      );

      expect(result.meta).toMatchObject({ page: 1, limit: 5, total: 1 });
      const journey = result.items[0];
      expect(journey).toMatchObject({
        id: 'j1',
        name: 'Pregnancy',
        type: 'OBGYN_PREGNANCY',
        status: 'ACTIVE',
        started_at: startedAt,
        ended_at: null,
      });
      expect(journey.episodes).toHaveLength(1);
      const episode = journey.episodes[0];
      expect(episode).toMatchObject({
        id: 'e1',
        name: 'First trimester',
        order: 1,
        status: 'COMPLETED',
      });
      expect(episode.visits[0]).toMatchObject({
        id: 'v1',
        completed_at: completedAt,
        doctor_name: 'Dr. Aya Hassan',
        organization_name: 'Jasmin Clinic',
        branch_name: 'Main Branch',
      });
    });
  });
});
