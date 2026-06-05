import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientNotificationsService } from './patient-notifications.service.js';
import { PatientNotificationsListener } from './patient-notifications.listener.js';
import { PATIENT_NOTIFICATION_CODES } from './patient-notification-codes.js';

describe('PatientNotificationsListener', () => {
  let listener: PatientNotificationsListener;
  let findUnique: jest.Mock;
  let create: jest.Mock;

  const journey = { patient_id: 'p1', organization_id: 'org-1' };
  const visitWith = (over: Record<string, unknown>) => ({
    prescription: null,
    investigations: [],
    episode: { journey },
    ...over,
  });
  const completed = { payload: { id: 'v1', status: 'COMPLETED' } };

  beforeEach(() => {
    findUnique = jest.fn();
    create = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      db: { visit: { findUnique } },
    } as unknown as PrismaService;
    listener = new PatientNotificationsListener(prisma, {
      create,
    } as unknown as PatientNotificationsService);
  });

  it('ignores non-COMPLETED status transitions', async () => {
    await listener.handleVisitStatusUpdated({
      payload: { id: 'v1', status: 'CANCELLED' },
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('notifies the patient about a new prescription', async () => {
    findUnique.mockResolvedValue(
      visitWith({ prescription: { items: [{ id: 'i1' }] } }),
    );
    await listener.handleVisitStatusUpdated(completed);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'p1',
        organizationId: 'org-1',
        code: PATIENT_NOTIFICATION_CODES.VISIT_PRESCRIPTION_ISSUED.code,
        navigateTo: '/medications',
        metadata: { visitId: 'v1' },
      }),
    );
  });

  it('notifies the patient about newly ordered tests', async () => {
    findUnique.mockResolvedValue(
      visitWith({ investigations: [{ id: 'inv1' }] }),
    );
    await listener.handleVisitStatusUpdated(completed);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        code: PATIENT_NOTIFICATION_CODES.VISIT_INVESTIGATION_ORDERED.code,
        navigateTo: '/tests',
      }),
    );
  });

  it('sends both notifications when the visit has a prescription and tests', async () => {
    findUnique.mockResolvedValue(
      visitWith({
        prescription: { items: [{ id: 'i1' }] },
        investigations: [{ id: 'inv1' }],
      }),
    );
    await listener.handleVisitStatusUpdated(completed);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('creates nothing when the visit has neither (empty prescription, no tests)', async () => {
    findUnique.mockResolvedValue(
      visitWith({ prescription: { items: [] }, investigations: [] }),
    );
    await listener.handleVisitStatusUpdated(completed);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates nothing when the visit resolves no journey', async () => {
    findUnique.mockResolvedValue({
      prescription: { items: [{ id: 'i1' }] },
      investigations: [],
      episode: null,
    });
    await listener.handleVisitStatusUpdated(completed);
    expect(create).not.toHaveBeenCalled();
  });
});
