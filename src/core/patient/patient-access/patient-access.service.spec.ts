import { NotFoundException } from '@nestjs/common';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PatientAccessService } from './patient-access.service';

const user: AuthContext = {
  userId: 'user-1',
  profileId: 'profile-1',
  organizationId: 'org-1',
  roles: ['STAFF'],
  branchIds: [],
};

describe('PatientAccessService.assertPatientAccessible', () => {
  let service: PatientAccessService;
  let findFirst: jest.Mock;
  let isOwner: jest.Mock;
  let getEffectiveBranchIds: jest.Mock;

  beforeEach(() => {
    findFirst = jest.fn();
    isOwner = jest.fn().mockResolvedValue(false);
    getEffectiveBranchIds = jest.fn().mockResolvedValue(['branch-a']);

    const prisma = { db: { patient: { findFirst } } };
    const authorization = { isOwner, getEffectiveBranchIds };

    service = new PatientAccessService(prisma as never, authorization as never);
  });

  it('OWNER reaches any patient in the org (org-level check, no branch filter)', async () => {
    isOwner.mockResolvedValue(true);
    findFirst.mockResolvedValue({ id: 'patient-1' });

    await expect(
      service.assertPatientAccessible('patient-1', user),
    ).resolves.toBeUndefined();

    expect(getEffectiveBranchIds).not.toHaveBeenCalled();
    // The org-level query carries no episode/visit branch filter.
    const where = findFirst.mock.calls[0][0].where;
    expect(where.journeys.some).not.toHaveProperty('episodes');
  });

  it('non-owner reaches a patient with a checked-in visit at an assigned branch', async () => {
    findFirst.mockResolvedValue({ id: 'patient-1' });

    await expect(
      service.assertPatientAccessible('patient-1', user),
    ).resolves.toBeUndefined();

    const where = findFirst.mock.calls[0][0].where;
    expect(where.journeys.some.episodes.some.visits.some).toMatchObject({
      branch_id: { in: ['branch-a'] },
      checked_in_at: { not: null },
    });
  });

  it('non-owner is denied when no accessible patient matches', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      service.assertPatientAccessible('patient-1', user),
    ).rejects.toThrow(NotFoundException);
  });

  it('non-owner with no assigned branches is denied without querying', async () => {
    getEffectiveBranchIds.mockResolvedValue([]);

    await expect(
      service.assertPatientAccessible('patient-1', user),
    ).rejects.toThrow(NotFoundException);

    expect(findFirst).not.toHaveBeenCalled();
  });
});
