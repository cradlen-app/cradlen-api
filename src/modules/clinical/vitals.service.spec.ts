import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { VitalsService } from './vitals.service';
import { VisitAccessService } from './visit-access.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-uuid',
  organizationId: 'org-uuid',
  activeBranchId: 'branch-uuid',
  roles: ['NURSE'],
  branchIds: ['branch-uuid'],
};

const mockVisitCheckedIn = {
  id: 'visit-uuid',
  branch_id: 'branch-uuid',
  status: 'CHECKED_IN',
  assigned_doctor_id: 'doctor-uuid',
};

describe('VitalsService', () => {
  let service: VitalsService;
  let db: { visitVitals: { findUnique: jest.Mock; upsert: jest.Mock } };
  let visitAccess: {
    loadOrThrow: jest.Mock;
    assertBranchAccess: jest.Mock;
    assertCanRecordVitals: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      visitVitals: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    visitAccess = {
      loadOrThrow: jest.fn().mockResolvedValue(mockVisitCheckedIn),
      assertBranchAccess: jest.fn(),
      assertCanRecordVitals: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VitalsService,
        { provide: PrismaService, useValue: { db } },
        { provide: VisitAccessService, useValue: visitAccess },
      ],
    }).compile();
    service = module.get<VitalsService>(VitalsService);
  });

  describe('upsert (BMI computation)', () => {
    it('computes BMI from weight + height in kg/m^2 to 1 decimal', async () => {
      db.visitVitals.upsert.mockImplementation(({ create }) => create);
      // 65 kg / (1.65 m)^2 = 23.876... → 23.9
      await service.upsert(
        'visit-uuid',
        { weight_kg: 65, height_cm: 165 },
        mockUser,
      );
      expect(db.visitVitals.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ bmi: 23.9 }),
        }),
      );
    });

    it('returns null BMI when weight missing', async () => {
      db.visitVitals.upsert.mockImplementation(({ create }) => create);
      await service.upsert('visit-uuid', { height_cm: 170 }, mockUser);
      expect(db.visitVitals.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ bmi: null }),
        }),
      );
    });

    it('returns null BMI when height is zero or missing', async () => {
      db.visitVitals.upsert.mockImplementation(({ create }) => create);
      await service.upsert(
        'visit-uuid',
        { weight_kg: 70, height_cm: 0 },
        mockUser,
      );
      expect(db.visitVitals.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ bmi: null }),
        }),
      );
    });

    it('rejects when assertCanRecordVitals throws (e.g. visit COMPLETED)', async () => {
      visitAccess.assertCanRecordVitals.mockRejectedValueOnce(
        new ForbiddenException('Cannot record vitals while visit is COMPLETED'),
      );
      await expect(
        service.upsert('visit-uuid', { weight_kg: 65 }, mockUser),
      ).rejects.toThrow(ForbiddenException);
      expect(db.visitVitals.upsert).not.toHaveBeenCalled();
    });

    it('does not trust client-supplied BMI (always recomputes from w/h)', async () => {
      db.visitVitals.upsert.mockImplementation(({ create }) => create);
      // Client sneaks in bmi via cast — service ignores it
      await service.upsert(
        'visit-uuid',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { weight_kg: 65, height_cm: 165, bmi: 999 } as any,
        mockUser,
      );
      const arg = db.visitVitals.upsert.mock.calls[0][0];
      expect(arg.create.bmi).toBe(23.9);
    });
  });
});
