import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { OwnerService } from './owner.service';
import { PrismaService } from '../../database/prisma.service';
import { StaffService } from '../staff/staff.service';

const OWNER_STAFF = {
  id: 'owner-staff-uuid',
  user_id: 'user-uuid',
  organization_id: 'org-uuid',
  branch_id: 'branch-uuid',
  role_id: 'owner-role-uuid',
  job_title: null,
  specialty: null,
  is_clinical: false,
  role: { id: 'owner-role-uuid', name: 'owner' },
  user: {
    id: 'user-uuid',
    first_name: 'Sara',
    last_name: 'Ali',
    email: 'sara@example.com',
    phone_number: '+201012345678',
  },
  organization: {
    id: 'org-uuid',
    name: 'Clinic',
    specialities: ['Cardiology'],
    status: 'ACTIVE',
  },
};

const DOCTOR_STAFF = {
  id: 'doctor-staff-uuid',
  user_id: 'user-uuid',
  organization_id: 'org-uuid',
  branch_id: 'branch-uuid',
  role_id: 'doctor-role-uuid',
  job_title: 'Consultant',
  specialty: 'Cardiology',
  is_clinical: true,
};

describe('OwnerService', () => {
  let service: OwnerService;
  let prismaMock: {
    db: {
      staff: {
        findFirst: jest.Mock;
        updateMany: jest.Mock;
        update: jest.Mock;
        create: jest.Mock;
      };
      user: { update: jest.Mock };
      role: { findFirst: jest.Mock };
      $transaction: jest.Mock;
    };
  };
  let staffServiceMock: { assertOwner: jest.Mock };

  beforeEach(() => {
    prismaMock = {
      db: {
        staff: {
          findFirst: jest.fn(),
          updateMany: jest.fn(),
          update: jest.fn(),
          create: jest.fn(),
        },
        user: { update: jest.fn() },
        role: { findFirst: jest.fn() },
        $transaction: jest.fn(async (cb) => cb(prismaMock.db)),
      },
    };
    staffServiceMock = { assertOwner: jest.fn().mockResolvedValue(undefined) };

    service = new OwnerService(
      prismaMock as unknown as PrismaService,
      staffServiceMock as unknown as StaffService,
    );
  });

  it('returns clinical fields from the doctor row when present', async () => {
    prismaMock.db.staff.findFirst
      .mockResolvedValueOnce(OWNER_STAFF)
      .mockResolvedValueOnce(DOCTOR_STAFF);

    const result = await service.getOwner('user-uuid', 'org-uuid');

    expect(result.staff).toEqual(
      expect.objectContaining({
        id: OWNER_STAFF.id,
        is_clinical: true,
        job_title: DOCTOR_STAFF.job_title,
        specialty: DOCTOR_STAFF.specialty,
        role: OWNER_STAFF.role,
      }),
    );
  });

  it('updates clinical fields on the existing doctor row', async () => {
    prismaMock.db.staff.findFirst
      .mockResolvedValueOnce(OWNER_STAFF)
      .mockResolvedValueOnce(DOCTOR_STAFF)
      .mockResolvedValueOnce({
        ...OWNER_STAFF,
        user: OWNER_STAFF.user,
        role: OWNER_STAFF.role,
        organization: OWNER_STAFF.organization,
      })
      .mockResolvedValueOnce({
        ...DOCTOR_STAFF,
        job_title: 'Lead Consultant',
      });

    await service.updateOwnerProfile('user-uuid', 'org-uuid', {
      job_title: 'Lead Consultant',
      specialty: 'Neurology',
    });

    expect(prismaMock.db.staff.update).toHaveBeenCalledWith({
      where: { id: DOCTOR_STAFF.id },
      data: {
        is_clinical: true,
        job_title: 'Lead Consultant',
        specialty: 'Neurology',
      },
    });
    expect(prismaMock.db.staff.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: { name: 'owner' } }),
      }),
    );
  });

  it('soft-deletes the doctor row when clinical is turned off', async () => {
    prismaMock.db.staff.findFirst
      .mockResolvedValueOnce(OWNER_STAFF)
      .mockResolvedValueOnce(DOCTOR_STAFF)
      .mockResolvedValueOnce(OWNER_STAFF)
      .mockResolvedValueOnce(null);

    await service.updateOwnerProfile('user-uuid', 'org-uuid', {
      is_clinical: false,
    });

    expect(prismaMock.db.staff.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: { name: 'doctor' } }),
        data: expect.objectContaining({
          is_deleted: true,
          deleted_at: expect.any(Date),
        }),
      }),
    );
  });

  it('requires specialty when enabling clinical without an existing specialty', async () => {
    prismaMock.db.staff.findFirst
      .mockResolvedValueOnce(OWNER_STAFF)
      .mockResolvedValueOnce(null);

    await expect(
      service.updateOwnerProfile('user-uuid', 'org-uuid', {
        is_clinical: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when enabling clinical and the doctor role is not seeded', async () => {
    prismaMock.db.staff.findFirst
      .mockResolvedValueOnce(OWNER_STAFF)
      .mockResolvedValueOnce(null);
    prismaMock.db.role.findFirst.mockResolvedValue(null);

    await expect(
      service.updateOwnerProfile('user-uuid', 'org-uuid', {
        is_clinical: true,
        specialty: 'Cardiology',
      }),
    ).rejects.toThrow(
      new InternalServerErrorException('Doctor role not seeded'),
    );
  });
});
