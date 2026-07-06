import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PatientConsent } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ConsentService } from './consent.service.js';
import { COMPLIANCE_EVENTS } from './compliance-events.js';

const USER: AuthContext = {
  userId: 'user-1',
  profileId: 'prof-1',
  organizationId: 'org-1',
  role: 'STAFF',
  jobFunction: 'RECEPTIONIST',
  branchIds: [],
};

function makeRow(over: Partial<PatientConsent> = {}): PatientConsent {
  return {
    id: 'c-1',
    patient_id: 'pat-1',
    organization_id: 'org-1',
    type: 'TREATMENT',
    status: 'GRANTED',
    consent_version: 'v1',
    captured_by_id: 'prof-1',
    granted_at: new Date('2026-07-06T00:00:00Z'),
    withdrawn_at: null,
    withdrawn_by_id: null,
    note: null,
    is_deleted: false,
    deleted_at: null,
    created_at: new Date('2026-07-06T00:00:00Z'),
    updated_at: new Date('2026-07-06T00:00:00Z'),
    ...over,
  };
}

describe('ConsentService', () => {
  let service: ConsentService;
  let create: jest.Mock;
  let findFirst: jest.Mock;
  let update: jest.Mock;
  let findMany: jest.Mock;
  let assertPatientInOrg: jest.Mock;
  let publish: jest.Mock;

  beforeEach(() => {
    create = jest.fn();
    findFirst = jest.fn();
    update = jest.fn();
    findMany = jest.fn();
    const prisma = {
      db: { patientConsent: { create, findFirst, update, findMany } },
    } as unknown as PrismaService;
    assertPatientInOrg = jest.fn().mockResolvedValue(undefined);
    const access = { assertPatientInOrg } as unknown as PatientAccessService;
    publish = jest.fn();
    const bus = { publish } as unknown as EventBus;
    service = new ConsentService(prisma, access, bus);
  });

  it('grants consent scoped to the caller org + profile and emits granted', async () => {
    create.mockResolvedValue(makeRow());
    const dto = { type: 'TREATMENT' as const, consent_version: 'v1' };

    const res = await service.grant('pat-1', dto, USER);

    expect(assertPatientInOrg).toHaveBeenCalledWith('pat-1', USER);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'pat-1',
        organization_id: 'org-1',
        type: 'TREATMENT',
        status: 'GRANTED',
        consent_version: 'v1',
        captured_by_id: 'prof-1',
      }),
    });
    expect(publish).toHaveBeenCalledWith(
      COMPLIANCE_EVENTS.CONSENT_GRANTED,
      expect.objectContaining({ patientId: 'pat-1', type: 'TREATMENT' }),
    );
    expect(res.status).toBe('GRANTED');
  });

  it('withdraws a granted consent and emits withdrawn', async () => {
    findFirst.mockResolvedValue(makeRow());
    update.mockResolvedValue(
      makeRow({ status: 'WITHDRAWN', withdrawn_by_id: 'prof-1' }),
    );

    const res = await service.withdraw('pat-1', 'c-1', {}, USER);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c-1' },
        data: expect.objectContaining({
          status: 'WITHDRAWN',
          withdrawn_by_id: 'prof-1',
        }),
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      COMPLIANCE_EVENTS.CONSENT_WITHDRAWN,
      expect.any(Object),
    );
    expect(res.status).toBe('WITHDRAWN');
  });

  it('rejects withdrawing an already-withdrawn consent', async () => {
    findFirst.mockResolvedValue(makeRow({ status: 'WITHDRAWN' }));
    await expect(
      service.withdraw('pat-1', 'c-1', {}, USER),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('404s when the consent row is not in the caller org', async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      service.withdraw('pat-1', 'missing', {}, USER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists consents org-scoped, newest first', async () => {
    findMany.mockResolvedValue([makeRow()]);
    const res = await service.list('pat-1', USER);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'pat-1',
          organization_id: 'org-1',
          is_deleted: false,
        }),
        orderBy: { created_at: 'desc' },
      }),
    );
    expect(res).toHaveLength(1);
  });
});
