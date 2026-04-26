jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2b$10$mocked-hash'),
  compare: jest.fn(),
}));

import {
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { StaffService } from './staff.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { createPrismaMock, type PrismaMock } from './__mocks__/prisma.mock.js';
import type { AcceptInvitationDto } from './dto/accept-invitation.dto.js';

const APP_CONFIG = { appUrl: 'http://localhost:3000' };
const AUTH_CONFIG = {
  invitationExpireHours: 72,
  jwt: {
    accessSecret: 'test-access-secret-at-least-32-chars!!',
    refreshSecret: 'test-refresh-secret-at-least-32!!',
    accessExpiration: '15m',
    refreshExpiration: '7d',
  },
};

const MOCK_OWNER_STAFF = {
  id: 'staff-uuid-1',
  user_id: 'owner-uuid-1',
  organization_id: 'org-uuid-1',
  branch_id: 'branch-uuid-1',
  role_id: 'role-uuid-owner',
  job_title: null,
  specialty: null,
  is_deleted: false,
  deleted_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const MOCK_BRANCH = {
  id: 'branch-uuid-1',
  organization_id: 'org-uuid-1',
  address: '123 Main St',
  city: 'Cairo',
  governorate: 'Cairo',
  is_main: true,
  status: 'ACTIVE' as const,
  is_deleted: false,
  deleted_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const MOCK_INVITATION = {
  id: 'invite-uuid-1',
  organization_id: 'org-uuid-1',
  invited_by_id: 'owner-uuid-1',
  role_id: 'role-uuid-doctor',
  email: 'doctor@example.com',
  first_name: 'Ahmed',
  last_name: 'Hassan',
  phone: null,
  job_title: 'Cardiologist',
  specialty: 'Cardiology',
  token_hash: '$2b$10$mocked-hash',
  status: 'PENDING' as const,
  expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000),
  accepted_at: null,
  is_deleted: false,
  deleted_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const INVITE_DTO = {
  organization_id: 'org-uuid-1',
  email: 'doctor@example.com',
  first_name: 'Ahmed',
  last_name: 'Hassan',
  role_id: 'role-uuid-doctor',
  job_title: 'Cardiologist',
  specialty: 'Cardiology',
  branches: [
    {
      branch_id: 'branch-uuid-1',
      schedule: {
        days: [{ day_of_week: 'MON' as const, shifts: [{ start_time: '09:00', end_time: '17:00' }] }],
      },
    },
  ],
};

describe('StaffService', () => {
  let service: StaffService;
  let prismaMock: PrismaMock;
  let mailMock: { sendStaffInvitationEmail: jest.Mock };

  beforeEach(async () => {
    prismaMock = createPrismaMock();
    mailMock = { sendStaffInvitationEmail: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: MailService, useValue: mailMock },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'app') return APP_CONFIG;
              if (key === 'auth') return AUTH_CONFIG;
              return null;
            }),
          },
        },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('mock-token') } },
      ],
    }).compile();

    service = module.get(StaffService);
  });

  describe('sendInvitation', () => {
    it('throws 403 when caller is not an owner', async () => {
      prismaMock.db.staff.findFirst.mockResolvedValue(null);
      await expect(service.sendInvitation('user-1', INVITE_DTO)).rejects.toThrow(ForbiddenException);
    });

    it('throws 400 when a branch does not belong to the org', async () => {
      prismaMock.db.staff.findFirst.mockResolvedValue(MOCK_OWNER_STAFF);
      prismaMock.db.branch.findMany.mockResolvedValue([]);
      await expect(service.sendInvitation('owner-uuid-1', INVITE_DTO)).rejects.toThrow(BadRequestException);
    });

    it('throws 409 when a pending invitation already exists', async () => {
      prismaMock.db.staff.findFirst.mockResolvedValue(MOCK_OWNER_STAFF);
      prismaMock.db.branch.findMany.mockResolvedValue([MOCK_BRANCH]);
      prismaMock.db.staffInvitation.findFirst.mockResolvedValue(MOCK_INVITATION);
      await expect(service.sendInvitation('owner-uuid-1', INVITE_DTO)).rejects.toThrow(ConflictException);
    });

    it('creates invitation and sends email on success', async () => {
      prismaMock.db.staff.findFirst.mockResolvedValue(MOCK_OWNER_STAFF);
      prismaMock.db.branch.findMany.mockResolvedValue([MOCK_BRANCH]);
      prismaMock.db.staffInvitation.findFirst.mockResolvedValue(null);
      prismaMock.db.$transaction.mockImplementation(
        (cb: (tx: typeof prismaMock.db) => Promise<unknown>) => cb(prismaMock.db),
      );
      prismaMock.db.staffInvitation.create.mockResolvedValue(MOCK_INVITATION);

      const result = await service.sendInvitation('owner-uuid-1', INVITE_DTO);

      expect(prismaMock.db.staffInvitation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'doctor@example.com' }) }),
      );
      expect(mailMock.sendStaffInvitationEmail).toHaveBeenCalledWith(
        'doctor@example.com',
        expect.stringContaining('http://localhost:3000'),
      );
      expect(result).toMatchObject({ id: 'invite-uuid-1', email: 'doctor@example.com' });
    });
  });

  describe('previewInvitation', () => {
    it('throws 410 when invitation is expired', async () => {
      prismaMock.db.staffInvitation.findFirst.mockResolvedValue({
        ...MOCK_INVITATION,
        expires_at: new Date(Date.now() - 1000),
        branches: [],
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(service.previewInvitation('raw-token', 'invite-uuid-1')).rejects.toThrow(
        expect.objectContaining({ status: 410 }),
      );
    });

    it('throws 401 when token does not match', async () => {
      prismaMock.db.staffInvitation.findFirst.mockResolvedValue({ ...MOCK_INVITATION, branches: [] });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(service.previewInvitation('wrong-token', 'invite-uuid-1')).rejects.toThrow(
        expect.objectContaining({ status: 401 }),
      );
    });

    it('returns preview with user_exists flag', async () => {
      prismaMock.db.staffInvitation.findFirst.mockResolvedValue({ ...MOCK_INVITATION, branches: [] });
      prismaMock.db.user.findFirst.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const result = await service.previewInvitation('raw-token', 'invite-uuid-1');
      expect(result).toMatchObject({ email: 'doctor@example.com', user_exists: false });
    });
  });

  describe('acceptInvitation', () => {
    const ACCEPT_DTO: AcceptInvitationDto = {
      invitation_id: 'invite-uuid-1',
      token: 'raw-token',
      password: 'password123',
    };

    it('throws 409 when invitation is already accepted', async () => {
      prismaMock.db.staffInvitation.findFirst.mockResolvedValue({
        ...MOCK_INVITATION,
        status: 'ACCEPTED',
        branches: [],
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(service.acceptInvitation(ACCEPT_DTO)).rejects.toThrow(ConflictException);
    });

    it('creates new user and staff records on acceptance', async () => {
      prismaMock.db.staffInvitation.findFirst.mockResolvedValue({
        ...MOCK_INVITATION,
        branches: [
          { id: 'sib-uuid-1', branch_id: 'branch-uuid-1', organization_id: 'org-uuid-1', schedule: { id: 'sched-uuid-1', days: [] } },
        ],
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prismaMock.db.$transaction.mockImplementation(
        (cb: (tx: typeof prismaMock.db) => Promise<unknown>) => cb(prismaMock.db),
      );
      prismaMock.db.user.findFirst.mockResolvedValue(null);
      prismaMock.db.user.create.mockResolvedValue({
        id: 'new-user-uuid',
        email: 'doctor@example.com',
        first_name: 'Ahmed',
        last_name: 'Hassan',
        phone_number: null,
        password_hashed: '$2b$10$hashed',
        is_active: true,
        is_deleted: false,
        verified_at: new Date(),
        registration_status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      });
      prismaMock.db.staff.create.mockResolvedValue({ id: 'staff-uuid-new', user_id: 'new-user-uuid' } as never);
      prismaMock.db.workingSchedule.create.mockResolvedValue({ id: 'sched-uuid-new' } as never);
      prismaMock.db.refreshToken.create.mockResolvedValue({} as never);
      prismaMock.db.staffInvitation.update.mockResolvedValue({ ...MOCK_INVITATION, status: 'ACCEPTED' });

      const result = await service.acceptInvitation(ACCEPT_DTO);
      expect(prismaMock.db.user.create).toHaveBeenCalled();
      expect(prismaMock.db.staff.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ organization_id: 'org-uuid-1' }) }),
      );
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
    });
  });

  describe('listInvitations', () => {
    it('throws 403 when caller is not owner', async () => {
      prismaMock.db.staff.findFirst.mockResolvedValue(null);
      await expect(
        service.listInvitations('user-1', { organization_id: 'org-uuid-1', page: 1, limit: 20 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns paginated invitations', async () => {
      prismaMock.db.staff.findFirst.mockResolvedValue(MOCK_OWNER_STAFF);
      prismaMock.db.staffInvitation.count.mockResolvedValue(1);
      prismaMock.db.staffInvitation.findMany.mockResolvedValue([MOCK_INVITATION]);
      const result = await service.listInvitations('owner-uuid-1', { organization_id: 'org-uuid-1', page: 1, limit: 20 });
      expect(result.items).toHaveLength(1);
    });
  });

  describe('cancelInvitation', () => {
    it('throws 400 when invitation is not pending', async () => {
      prismaMock.db.staff.findFirst.mockResolvedValue(MOCK_OWNER_STAFF);
      prismaMock.db.staffInvitation.findFirst.mockResolvedValue({ ...MOCK_INVITATION, status: 'ACCEPTED' });
      await expect(
        service.cancelInvitation('owner-uuid-1', 'invite-uuid-1', 'org-uuid-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('marks invitation as CANCELLED', async () => {
      prismaMock.db.staff.findFirst.mockResolvedValue(MOCK_OWNER_STAFF);
      prismaMock.db.staffInvitation.findFirst.mockResolvedValue(MOCK_INVITATION);
      prismaMock.db.staffInvitation.update.mockResolvedValue({ ...MOCK_INVITATION, status: 'CANCELLED' });
      await service.cancelInvitation('owner-uuid-1', 'invite-uuid-1', 'org-uuid-1');
      expect(prismaMock.db.staffInvitation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
    });
  });

  describe('listStaff', () => {
    const MOCK_STAFF_RECORD = {
      id: 'staff-uuid-2',
      user_id: 'doctor-uuid-1',
      organization_id: 'org-uuid-1',
      branch_id: 'branch-uuid-1',
      role_id: 'role-uuid-doctor',
      job_title: 'Cardiologist',
      specialty: 'Cardiology',
      is_deleted: false,
      deleted_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      user: { id: 'doctor-uuid-1', first_name: 'Ahmed', last_name: 'Hassan', email: 'doctor@example.com', phone_number: null },
      role: { id: 'role-uuid-doctor', name: 'doctor' },
      schedule: null,
    };

    it('returns paginated staff for org', async () => {
      prismaMock.db.staff.findFirst.mockResolvedValue(MOCK_OWNER_STAFF);
      prismaMock.db.staff.count.mockResolvedValue(1);
      prismaMock.db.staff.findMany.mockResolvedValue([MOCK_STAFF_RECORD]);
      const result = await service.listStaff('owner-uuid-1', { organization_id: 'org-uuid-1', page: 1, limit: 20 });
      expect(result.items).toHaveLength(1);
    });

    it('throws 403 when caller is not owner', async () => {
      prismaMock.db.staff.findFirst.mockResolvedValue(null);
      await expect(
        service.listStaff('user-1', { organization_id: 'org-uuid-1', page: 1, limit: 20 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteStaff', () => {
    it('soft-deletes staff record', async () => {
      prismaMock.db.staff.findFirst
        .mockResolvedValueOnce(MOCK_OWNER_STAFF)
        .mockResolvedValueOnce({ id: 'staff-uuid-2', user_id: 'doctor-uuid-1', is_deleted: false } as never);
      prismaMock.db.staff.update.mockResolvedValue({} as never);
      await service.deleteStaff('owner-uuid-1', 'staff-uuid-2', 'org-uuid-1');
      expect(prismaMock.db.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ is_deleted: true }) }),
      );
    });
  });

  describe('updateSchedule', () => {
    it('throws 403 when caller is neither owner nor the staff member', async () => {
      prismaMock.db.staff.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'staff-uuid-2', user_id: 'other-user', is_deleted: false } as never);
      await expect(
        service.updateSchedule('random-user', 'staff-uuid-2', 'org-uuid-1', { days: [] }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('replaces schedule when caller is the staff member', async () => {
      prismaMock.db.staff.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'staff-uuid-2', user_id: 'doctor-uuid-1', is_deleted: false } as never);
      prismaMock.db.$transaction.mockImplementation(
        (cb: (tx: typeof prismaMock.db) => Promise<unknown>) => cb(prismaMock.db),
      );
      prismaMock.db.workingSchedule.delete.mockRejectedValue(new Error('not found'));
      prismaMock.db.workingSchedule.create.mockResolvedValue({ id: 'new-sched' } as never);
      await service.updateSchedule('doctor-uuid-1', 'staff-uuid-2', 'org-uuid-1', { days: [] });
      expect(prismaMock.db.workingSchedule.create).toHaveBeenCalled();
    });
  });
});
