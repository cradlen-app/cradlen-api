import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { JourneysService } from './journeys.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-A',
  organizationId: 'org-A',
  activeBranchId: 'branch-uuid',
  roles: ['OWNER'],
  branchIds: ['branch-uuid'],
};

function visitRow(carePathCode: string | null, specialtyCode: string | null) {
  return {
    episode: {
      id: 'episode-1',
      journey: {
        id: 'journey-1',
        status: 'ACTIVE',
        started_at: new Date('2026-01-01'),
        ended_at: null,
        care_path: carePathCode
          ? {
              code: carePathCode,
              name: 'Pregnancy',
              specialty: specialtyCode ? { code: specialtyCode } : null,
            }
          : null,
      },
    },
  };
}

describe('JourneysService', () => {
  let service: JourneysService;
  let db: {
    visit: { findFirst: jest.Mock };
    carePathClinicalSurface: { findFirst: jest.Mock };
  };
  let access: { assertVisitInOrg: jest.Mock };

  beforeEach(async () => {
    db = {
      visit: { findFirst: jest.fn() },
      carePathClinicalSurface: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    access = { assertVisitInOrg: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JourneysService,
        { provide: PrismaService, useValue: { db } },
        { provide: PatientAccessService, useValue: access },
      ],
    }).compile();

    service = module.get(JourneysService);
  });

  it('returns clinical_surface: null when the care path declares none', async () => {
    db.visit.findFirst.mockResolvedValue(visitRow('OBGYN_GENERAL', 'OBGYN'));

    const result = await service.getActiveJourneyForVisit('visit-1', mockUser);

    expect(access.assertVisitInOrg).toHaveBeenCalledWith('visit-1', mockUser);
    expect(result).toMatchObject({
      journey_id: 'journey-1',
      episode_id: 'episode-1',
      care_path_code: 'OBGYN_GENERAL',
      specialty_code: 'OBGYN',
      status: 'ACTIVE',
      clinical_surface: null,
    });
  });

  it('folds in the declared clinical surface when present', async () => {
    db.visit.findFirst.mockResolvedValue(visitRow('OBGYN_PREGNANCY', 'OBGYN'));
    db.carePathClinicalSurface.findFirst.mockResolvedValue({
      template_code: 'obgyn_pregnancy',
      label: 'Pregnancy',
    });

    const result = await service.getActiveJourneyForVisit('visit-1', mockUser);

    expect(db.carePathClinicalSurface.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          specialty_code: 'OBGYN',
          care_path_code: 'OBGYN_PREGNANCY',
          is_deleted: false,
        }),
      }),
    );
    expect(result?.clinical_surface).toEqual({
      template_code: 'obgyn_pregnancy',
      label: 'Pregnancy',
    });
  });

  it('returns null when the visit has no journey', async () => {
    db.visit.findFirst.mockResolvedValue({ episode: null });

    const result = await service.getActiveJourneyForVisit('visit-1', mockUser);

    expect(result).toBeNull();
    expect(db.carePathClinicalSurface.findFirst).not.toHaveBeenCalled();
  });

  it('does not query the surface when the journey has no care path', async () => {
    db.visit.findFirst.mockResolvedValue(visitRow(null, null));

    const result = await service.getActiveJourneyForVisit('visit-1', mockUser);

    expect(result?.clinical_surface).toBeNull();
    expect(db.carePathClinicalSurface.findFirst).not.toHaveBeenCalled();
  });

  it('propagates a cross-org access rejection', async () => {
    access.assertVisitInOrg.mockRejectedValue(new NotFoundException());

    await expect(
      service.getActiveJourneyForVisit('visit-1', mockUser),
    ).rejects.toThrow(NotFoundException);
    expect(db.visit.findFirst).not.toHaveBeenCalled();
  });
});
