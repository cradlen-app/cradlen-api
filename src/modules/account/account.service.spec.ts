import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccountService } from './account.service';
import { PrismaService } from '../../database/prisma.service';
import { OwnerService } from '../owner/owner.service';

const USER = {
  id: 'user-uuid',
  first_name: 'Mona',
  last_name: 'Amin',
  email: 'mona@example.com',
  phone_number: '+201000000000',
};

const ORGANIZATION = {
  id: 'org-uuid',
  name: 'Clinic',
  specialities: ['Cardiology'],
  status: 'ACTIVE',
};

describe('AccountService', () => {
  let service: AccountService;
  let prismaMock: {
    db: {
      staff: {
        findFirst: jest.Mock;
        findFirstOrThrow: jest.Mock;
        findMany: jest.Mock;
        count: jest.Mock;
        update: jest.Mock;
        updateMany: jest.Mock;
      };
      user: { update: jest.Mock };
      profile: { updateMany: jest.Mock };
      refreshToken: { updateMany: jest.Mock };
      organization: { update: jest.Mock };
      branch: { updateMany: jest.Mock };
      subscription: { updateMany: jest.Mock };
      staffInvitation: { updateMany: jest.Mock };
      $transaction: jest.Mock;
    };
  };
  let ownerServiceMock: { updateOwnerProfile: jest.Mock };

  beforeEach(() => {
    prismaMock = {
      db: {
        staff: {
          findFirst: jest.fn(),
          findFirstOrThrow: jest.fn(),
          findMany: jest.fn(),
          count: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn(),
        },
        user: { update: jest.fn() },
        profile: { updateMany: jest.fn() },
        refreshToken: { updateMany: jest.fn() },
        organization: { update: jest.fn() },
        branch: { updateMany: jest.fn() },
        subscription: { updateMany: jest.fn() },
        staffInvitation: { updateMany: jest.fn() },
        $transaction: jest.fn(async (cb) => cb(prismaMock.db)),
      },
    };
    ownerServiceMock = { updateOwnerProfile: jest.fn() };

    service = new AccountService(
      prismaMock as unknown as PrismaService,
      ownerServiceMock as unknown as OwnerService,
    );
  });

  it('delegates owner profile updates to owner settings logic', async () => {
    prismaMock.db.staff.findFirst.mockResolvedValue({
      id: 'owner-staff',
      organization_id: 'org-uuid',
      role: { id: 'role-owner', name: 'owner' },
      user: USER,
      organization: ORGANIZATION,
    });
    ownerServiceMock.updateOwnerProfile.mockResolvedValue({ user: USER });

    await service.updateProfile('user-uuid', {
      organization_id: 'org-uuid',
      first_name: 'Mona',
      is_clinical: true,
      specialty: 'Cardiology',
    });

    expect(ownerServiceMock.updateOwnerProfile).toHaveBeenCalledWith(
      'user-uuid',
      'org-uuid',
      {
        first_name: 'Mona',
        is_clinical: true,
        specialty: 'Cardiology',
      },
    );
  });

  it('allows doctors to update their own user and staff profile fields', async () => {
    prismaMock.db.staff.findFirst.mockResolvedValue({
      id: 'doctor-staff',
      organization_id: 'org-uuid',
      role: { id: 'role-doctor', name: 'doctor' },
      user: USER,
      organization: ORGANIZATION,
    });
    prismaMock.db.staff.findFirstOrThrow.mockResolvedValue({
      id: 'doctor-staff',
      organization_id: 'org-uuid',
      is_clinical: true,
      job_title: 'Consultant',
      specialty: 'Cardiology',
      user: { ...USER, first_name: 'Mona' },
      role: { id: 'role-doctor', name: 'doctor' },
      organization: ORGANIZATION,
    });

    const result = await service.updateProfile('user-uuid', {
      first_name: 'Mona',
      job_title: 'Consultant',
      specialty: 'Cardiology',
    });

    expect(prismaMock.db.user.update).toHaveBeenCalledWith({
      where: { id: 'user-uuid' },
      data: { first_name: 'Mona' },
    });
    expect(prismaMock.db.staff.update).toHaveBeenCalledWith({
      where: { id: 'doctor-staff' },
      data: {
        is_clinical: true,
        job_title: 'Consultant',
        specialty: 'Cardiology',
      },
    });
    expect(result.staff.role.name).toBe('doctor');
  });

  it('rejects users without owner or doctor settings access', async () => {
    prismaMock.db.staff.findFirst.mockResolvedValue(null);

    await expect(service.updateProfile('user-uuid', {})).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('keeps doctor profiles clinical', async () => {
    prismaMock.db.staff.findFirst.mockResolvedValue({
      id: 'doctor-staff',
      organization_id: 'org-uuid',
      role: { id: 'role-doctor', name: 'doctor' },
      user: USER,
      organization: ORGANIZATION,
    });

    await expect(
      service.updateProfile('user-uuid', { is_clinical: false }),
    ).rejects.toThrow(BadRequestException);
  });

  it('deactivates the account and cascades sole-owned active organizations', async () => {
    prismaMock.db.staff.findMany.mockResolvedValue([
      { organization_id: 'org-uuid' },
    ]);
    prismaMock.db.staff.count.mockResolvedValue(0);

    const result = await service.deactivate('user-uuid', {});

    expect(prismaMock.db.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-uuid' },
      data: {
        status: 'INACTIVE',
        is_deleted: true,
        deleted_at: expect.any(Date),
      },
    });
    expect(prismaMock.db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { user_id: 'user-uuid', is_revoked: false },
      data: { is_revoked: true, revoked_at: expect.any(Date) },
    });
    expect(prismaMock.db.user.update).toHaveBeenCalledWith({
      where: { id: 'user-uuid' },
      data: {
        is_active: false,
        is_deleted: true,
        deleted_at: expect.any(Date),
      },
    });
    expect(result).toEqual({ user_id: 'user-uuid', is_active: false });
  });
});
