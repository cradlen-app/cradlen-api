import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AllergiesService } from './allergies.service';
import { PatientAccessService } from './patient-access.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';

// This suite doubles as the wiring check for PatientSubrecordReadService:
// AllergiesService declares no constructor, so its success here proves Nest
// resolves the base class's injected deps through the prototype chain.
const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-uuid',
  organizationId: 'org-uuid',
  roles: ['DOCTOR'],
  branchIds: ['branch-uuid'],
};

describe('AllergiesService', () => {
  let service: AllergiesService;
  let patientAllergy: { findMany: jest.Mock };
  let patientAccess: { assertPatientInOrg: jest.Mock };

  beforeEach(async () => {
    patientAllergy = { findMany: jest.fn() };
    patientAccess = { assertPatientInOrg: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllergiesService,
        { provide: PrismaService, useValue: { db: { patientAllergy } } },
        { provide: PatientAccessService, useValue: patientAccess },
      ],
    }).compile();
    service = module.get(AllergiesService);
  });

  it('resolves with its inherited (base-class) dependencies', () => {
    expect(service).toBeInstanceOf(AllergiesService);
  });

  it('asserts patient access before returning the soft-delete-filtered list', async () => {
    const rows = [{ id: 'a1' }];
    patientAllergy.findMany.mockResolvedValue(rows);

    const result = await service.findAll('patient-uuid', mockUser);

    expect(patientAccess.assertPatientInOrg).toHaveBeenCalledWith(
      'patient-uuid',
      mockUser,
    );
    expect(patientAllergy.findMany).toHaveBeenCalledWith({
      where: { patient_id: 'patient-uuid', is_deleted: false },
      orderBy: { created_at: 'desc' },
    });
    expect(result).toBe(rows);
  });

  it('does not query when the access check rejects', async () => {
    patientAccess.assertPatientInOrg.mockRejectedValue(new NotFoundException());

    await expect(service.findAll('patient-uuid', mockUser)).rejects.toThrow(
      NotFoundException,
    );
    expect(patientAllergy.findMany).not.toHaveBeenCalled();
  });
});
