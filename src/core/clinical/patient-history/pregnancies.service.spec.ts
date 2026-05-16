import { Test, TestingModule } from '@nestjs/testing';
import { PregnanciesService } from './pregnancies.service';
import { PatientAccessService } from './patient-access.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-uuid',
  organizationId: 'org-uuid',
  activeBranchId: 'branch-uuid',
  roles: ['OBGYN'],
  branchIds: ['branch-uuid'],
};

describe('PregnanciesService', () => {
  let service: PregnanciesService;
  let db: {
    patientPregnancyHistory: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    patientObgynHistory: { upsert: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      patientPregnancyHistory: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      patientObgynHistory: { upsert: jest.fn() },
      $transaction: jest
        .fn()
        .mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) =>
          cb(db),
        ),
    };
    const access = { assertPatientInOrg: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PregnanciesService,
        { provide: PrismaService, useValue: { db } },
        { provide: PatientAccessService, useValue: access },
      ],
    }).compile();
    service = module.get<PregnanciesService>(PregnanciesService);
  });

  describe('obstetric_summary recompute', () => {
    /** helper: invoke `create` with given existing rows after the new row is added */
    async function recomputeFromHistory(
      rows: Array<{
        outcome: string | null;
        gestational_age_weeks?: number | null;
      }>,
    ) {
      db.patientPregnancyHistory.create.mockResolvedValue({ id: 'p-1' });
      db.patientPregnancyHistory.findMany.mockResolvedValue(rows);
      await service.create(
        'patient-uuid',
        { outcome: rows[rows.length - 1]?.outcome ?? undefined },
        mockUser,
      );
      const upsertCall = db.patientObgynHistory.upsert.mock.calls[0]?.[0];
      return upsertCall?.update?.obstetric_summary as {
        gravida: number;
        para: number;
        abortion: number;
      };
    }

    it('counts LIVE_BIRTH as para', async () => {
      const summary = await recomputeFromHistory([
        { outcome: 'LIVE_BIRTH' },
        { outcome: 'LIVE_BIRTH' },
      ]);
      expect(summary).toEqual({ gravida: 2, para: 2, abortion: 0 });
    });

    it('counts MISCARRIAGE / ABORTION / ECTOPIC as abortion', async () => {
      const summary = await recomputeFromHistory([
        { outcome: 'MISCARRIAGE' },
        { outcome: 'ABORTION' },
        { outcome: 'ECTOPIC' },
      ]);
      expect(summary).toEqual({ gravida: 3, para: 0, abortion: 3 });
    });

    it('counts STILLBIRTH at >=20 weeks as para; <20 weeks does not count', async () => {
      const summary = await recomputeFromHistory([
        { outcome: 'STILLBIRTH', gestational_age_weeks: 28 },
        { outcome: 'STILLBIRTH', gestational_age_weeks: 18 },
      ]);
      // Both bump gravida; only the 28-week one bumps para. The 18-week one is uncategorized
      // (intentional — clinical sub-20 STILLBIRTH is rare and ambiguous).
      expect(summary).toEqual({ gravida: 2, para: 1, abortion: 0 });
    });

    it('handles a mixed history correctly', async () => {
      const summary = await recomputeFromHistory([
        { outcome: 'LIVE_BIRTH' },
        { outcome: 'MISCARRIAGE' },
        { outcome: 'LIVE_BIRTH' },
        { outcome: 'ECTOPIC' },
      ]);
      expect(summary).toEqual({ gravida: 4, para: 2, abortion: 2 });
    });

    it('treats unknown / null outcomes as gravida-only (no para, no abortion)', async () => {
      const summary = await recomputeFromHistory([
        { outcome: null },
        { outcome: 'ONGOING' },
      ]);
      expect(summary).toEqual({ gravida: 2, para: 0, abortion: 0 });
    });

    it('is case-insensitive on outcome strings', async () => {
      const summary = await recomputeFromHistory([
        { outcome: 'live_birth' },
        { outcome: 'miscarriage' },
      ]);
      expect(summary).toEqual({ gravida: 2, para: 1, abortion: 1 });
    });
  });
});
