import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MedicationsService } from './medications.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService } from '../../common/authorization/authorization.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

const callerOrg = 'org-A';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-A',
  organizationId: callerOrg,
  activeBranchId: 'branch-uuid',
  roles: ['OWNER'],
  branchIds: ['branch-uuid'],
};

describe('MedicationsService', () => {
  let service: MedicationsService;
  let db: {
    medication: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let auth: { isOwner: jest.Mock; assertOwnerOnly: jest.Mock };

  beforeEach(async () => {
    db = {
      medication: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    auth = {
      isOwner: jest.fn().mockResolvedValue(true),
      assertOwnerOnly: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicationsService,
        { provide: PrismaService, useValue: { db } },
        { provide: AuthorizationService, useValue: auth },
      ],
    }).compile();
    service = module.get<MedicationsService>(MedicationsService);
  });

  describe('assertReferenceable', () => {
    it('allows global rows (organization_id = null)', async () => {
      db.medication.findUnique.mockResolvedValue({ organization_id: null });
      await expect(
        service.assertReferenceable('med-uuid', mockUser),
      ).resolves.toBeUndefined();
    });

    it('allows rows owned by the caller org', async () => {
      db.medication.findUnique.mockResolvedValue({
        organization_id: callerOrg,
      });
      await expect(
        service.assertReferenceable('med-uuid', mockUser),
      ).resolves.toBeUndefined();
    });

    it('rejects rows owned by another org with 400', async () => {
      db.medication.findUnique.mockResolvedValue({ organization_id: 'org-B' });
      await expect(
        service.assertReferenceable('med-uuid', mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects nonexistent / soft-deleted rows', async () => {
      db.medication.findUnique.mockResolvedValue(null);
      await expect(
        service.assertReferenceable('med-uuid', mockUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    it('throws ConflictException on duplicate code in same org', async () => {
      db.medication.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create({ code: 'CUSTOM', name: 'Custom drug' }, mockUser),
      ).rejects.toThrow(ConflictException);
    });

    it('sets organization_id and added_by_id from caller', async () => {
      db.medication.findFirst.mockResolvedValue(null);
      db.medication.create.mockImplementation(({ data }) => data);
      await service.create({ code: 'NEW_DRUG', name: 'Drug' }, mockUser);
      const data = db.medication.create.mock.calls[0][0].data;
      expect(data.organization_id).toBe(callerOrg);
      expect(data.added_by_id).toBe('profile-A');
    });
  });

  describe('update', () => {
    it('rejects mutations on global rows', async () => {
      db.medication.findUnique.mockResolvedValue({
        id: 'med-uuid',
        organization_id: null,
      });
      await expect(
        service.update('med-uuid', { name: 'tampered' }, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('hides cross-org rows behind 404', async () => {
      db.medication.findUnique.mockResolvedValue({
        id: 'med-uuid',
        organization_id: 'org-B',
      });
      await expect(
        service.update('med-uuid', { name: 'edited' }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when caller is non-OWNER and not the original creator', async () => {
      db.medication.findUnique.mockResolvedValue({
        id: 'med-uuid',
        organization_id: callerOrg,
        added_by_id: 'someone-else',
      });
      auth.isOwner.mockResolvedValueOnce(false);
      await expect(
        service.update('med-uuid', { name: 'edited' }, mockUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows OWNER to edit any org-scoped row', async () => {
      db.medication.findUnique.mockResolvedValue({
        id: 'med-uuid',
        organization_id: callerOrg,
        added_by_id: 'someone-else',
      });
      db.medication.update.mockResolvedValue({
        id: 'med-uuid',
        name: 'edited',
      });
      await expect(
        service.update('med-uuid', { name: 'edited' }, mockUser),
      ).resolves.toEqual({ id: 'med-uuid', name: 'edited' });
    });
  });
});
