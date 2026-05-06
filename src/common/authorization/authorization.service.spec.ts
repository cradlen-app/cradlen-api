import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { PrismaService } from '../../database/prisma.service';

describe('AuthorizationService.assertCanViewStaff', () => {
  let service: AuthorizationService;
  let profileRole: { findFirst: jest.Mock };

  beforeEach(async () => {
    profileRole = { findFirst: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        {
          provide: PrismaService,
          useValue: { db: { profileRole } },
        },
      ],
    }).compile();
    service = module.get(AuthorizationService);
  });

  it('allows OWNER', async () => {
    profileRole.findFirst.mockResolvedValue({ id: 'pr-1' });
    await expect(
      service.assertCanViewStaff('prof-1', 'org-1'),
    ).resolves.toBeUndefined();
  });

  it('allows DOCTOR', async () => {
    profileRole.findFirst.mockResolvedValue({ id: 'pr-2' });
    await expect(
      service.assertCanViewStaff('prof-2', 'org-1'),
    ).resolves.toBeUndefined();
  });

  it('allows RECEPTIONIST', async () => {
    profileRole.findFirst.mockResolvedValue({ id: 'pr-3' });
    await expect(
      service.assertCanViewStaff('prof-3', 'org-1'),
    ).resolves.toBeUndefined();
  });

  it('throws ForbiddenException when no matching role', async () => {
    profileRole.findFirst.mockResolvedValue(null);
    await expect(service.assertCanViewStaff('prof-4', 'org-1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
