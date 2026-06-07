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

describe('MedicalRepVisitService', () => {
  let service: MedicalRepVisitService;
  let db: {
    medicalRepVisit: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      medicalRepVisit: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      },
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
});
