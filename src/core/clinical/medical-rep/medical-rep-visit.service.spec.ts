import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MedicalRepVisitService } from './medical-rep-visit.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { TemplateValidator } from '@builder/validator/template.validator';
import { TemplatesService } from '@builder/templates/templates.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-uuid',
  organizationId: 'org-uuid',
  activeBranchId: 'branch-uuid',
  roles: ['OBGYN'],
  branchIds: ['branch-uuid'],
};

// Same identity, but an OWNER — reaches every branch in the org.
const ownerUser: AuthContext = { ...mockUser, roles: ['OWNER'] };

describe('MedicalRepVisitService', () => {
  let service: MedicalRepVisitService;
  let db: {
    medicalRepVisit: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
    };
    branch: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      medicalRepVisit: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      },
      branch: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicalRepVisitService,
        { provide: PrismaService, useValue: { db } },
        { provide: EventBus, useValue: { publish: jest.fn() } },
        {
          provide: TemplateValidator,
          useValue: { validatePayload: jest.fn() },
        },
        {
          provide: TemplatesService,
          useValue: { findActiveByCode: jest.fn() },
        },
      ],
    }).compile();
    service = module.get<MedicalRepVisitService>(MedicalRepVisitService);
  });

  describe('findMyWaitingList', () => {
    it('scopes to the branch AND the current doctor (within the org)', async () => {
      db.$transaction.mockResolvedValue([[], 0]);
      await service.findMyWaitingList('branch-uuid', {}, mockUser);
      expect(db.medicalRepVisit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organization_id: mockUser.organizationId,
            assigned_doctor_id: mockUser.profileId,
            branch_id: 'branch-uuid',
            status: { in: ['SCHEDULED', 'CHECKED_IN'] },
          }),
        }),
      );
    });
  });

  describe('findMyCurrent', () => {
    it('scopes to the branch AND the current doctor (within the org)', async () => {
      db.medicalRepVisit.findFirst.mockResolvedValue(null);
      await service.findMyCurrent('branch-uuid', mockUser);
      expect(db.medicalRepVisit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organization_id: mockUser.organizationId,
            assigned_doctor_id: mockUser.profileId,
            branch_id: 'branch-uuid',
            status: 'IN_PROGRESS',
          }),
        }),
      );
    });
  });

  describe('listVisits — branch gating', () => {
    it('confines a non-owner to their assigned branches', async () => {
      db.$transaction.mockResolvedValue([[], 0]);
      await service.listVisits(mockUser, {});
      expect(db.medicalRepVisit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organization_id: mockUser.organizationId,
            branch_id: { in: mockUser.branchIds },
          }),
        }),
      );
    });

    it('rejects a non-owner asking for a branch they cannot reach', async () => {
      await expect(
        service.listVisits(mockUser, { branch_id: 'other-branch' }),
      ).rejects.toThrow(ForbiddenException);
      expect(db.medicalRepVisit.findMany).not.toHaveBeenCalled();
    });

    it('lets an OWNER see the org-wide list (no branch constraint)', async () => {
      db.$transaction.mockResolvedValue([[], 0]);
      await service.listVisits(ownerUser, {});
      const where = db.medicalRepVisit.findMany.mock.calls[0][0].where;
      expect(where.branch_id).toBeUndefined();
      expect(where.organization_id).toBe(ownerUser.organizationId);
    });
  });

  describe('branch queues — branch gating', () => {
    it('rejects a non-owner reading a non-assigned branch waiting list', async () => {
      db.branch.findFirst.mockResolvedValue({ id: 'other-branch' });
      await expect(
        service.findBranchWaitingList('other-branch', {}, mockUser),
      ).rejects.toThrow(ForbiddenException);
      expect(db.medicalRepVisit.findMany).not.toHaveBeenCalled();
    });

    it('rejects a non-owner reading a non-assigned branch in-progress list', async () => {
      db.branch.findFirst.mockResolvedValue({ id: 'other-branch' });
      await expect(
        service.findBranchInProgress('other-branch', {}, mockUser),
      ).rejects.toThrow(ForbiddenException);
      expect(db.medicalRepVisit.findMany).not.toHaveBeenCalled();
    });
  });

  describe('rep visit history — branch gating', () => {
    it('confines a non-owner to their assigned branches', async () => {
      db.$transaction.mockResolvedValue([[], 0]);
      await service.listRepVisitHistory('rep-1', {}, mockUser);
      expect(db.medicalRepVisit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            medical_rep_id: 'rep-1',
            status: 'COMPLETED',
            branch_id: { in: mockUser.branchIds },
          }),
        }),
      );
    });

    it('lets an OWNER see the rep history across all branches', async () => {
      db.$transaction.mockResolvedValue([[], 0]);
      await service.listRepVisitHistory('rep-1', {}, ownerUser);
      const where = db.medicalRepVisit.findMany.mock.calls[0][0].where;
      expect(where.branch_id).toBeUndefined();
      expect(where.medical_rep_id).toBe('rep-1');
    });
  });

  describe('single visit — branch gating', () => {
    it('rejects a non-owner opening a visit at another branch', async () => {
      db.medicalRepVisit.findFirst.mockResolvedValue({
        id: 'visit-1',
        branch_id: 'other-branch',
      });
      await expect(service.findVisit('visit-1', mockUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns a visit at the caller’s own branch', async () => {
      db.medicalRepVisit.findFirst.mockResolvedValue({
        id: 'visit-1',
        branch_id: 'branch-uuid',
      });
      await expect(service.findVisit('visit-1', mockUser)).resolves.toEqual(
        expect.objectContaining({ id: 'visit-1' }),
      );
    });

    it('blocks a status transition on a visit at another branch', async () => {
      db.medicalRepVisit.findFirst.mockResolvedValue({
        id: 'visit-1',
        branch_id: 'other-branch',
        status: 'SCHEDULED',
      });
      await expect(
        service.updateVisitStatus(
          'visit-1',
          { status: 'CHECKED_IN' },
          mockUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
