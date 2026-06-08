import { Test, TestingModule } from '@nestjs/testing';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import authConfig from '@config/auth.config';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageService } from '@infrastructure/storage/storage.service';
import { AuthorizationService } from '@core/auth/authorization/authorization.service';
import { SpecialtyCatalogService } from '@core/org/specialty-catalog/specialty-catalog.public';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { OrganizationsService } from './organizations.service';

const ORG_ID = '33333333-3333-4333-8333-333333333333';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';

const specialtyRow = {
  id: 'spec-uuid',
  code: 'OBGYN',
  name: 'Gynecology',
  is_deleted: false,
};

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let db: Record<string, Record<string, jest.Mock>> & {
    $transaction: jest.Mock;
  };
  let authorization: {
    assertCanAccessOrganization: jest.Mock;
    assertCanManageOrganization: jest.Mock;
  };
  let specialties: { resolveByCodeOrName: jest.Mock };
  let subscriptions: { assertOrganizationLimit: jest.Mock };
  let storage: {
    createPresignedUploadUrl: jest.Mock;
    createPresignedDownloadUrl: jest.Mock;
    headObject: jest.Mock;
    deleteObject: jest.Mock;
    assertAllowedContentType: jest.Mock;
    assertWithinSizeLimit: jest.Mock;
    extensionFor: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      organization: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      organizationSpecialty: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      role: { findUnique: jest.fn() },
      subscriptionPlan: { findUnique: jest.fn() },
      profile: { findMany: jest.fn(), count: jest.fn() },
      branch: { updateMany: jest.fn() },
      subscription: { updateMany: jest.fn() },
      invitation: { updateMany: jest.fn() },
      user: { updateMany: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
      $transaction: jest.fn(),
    } as never;

    authorization = {
      assertCanAccessOrganization: jest.fn().mockResolvedValue(undefined),
      assertCanManageOrganization: jest.fn().mockResolvedValue(undefined),
    };
    specialties = { resolveByCodeOrName: jest.fn().mockResolvedValue([]) };
    subscriptions = {
      assertOrganizationLimit: jest.fn().mockResolvedValue(undefined),
    };
    storage = {
      createPresignedUploadUrl: jest
        .fn()
        .mockResolvedValue({ url: 'https://r2/put', expiresIn: 300 }),
      createPresignedDownloadUrl: jest
        .fn()
        .mockResolvedValue('https://r2/get'),
      headObject: jest
        .fn()
        .mockResolvedValue({ contentType: 'image/png', contentLength: 1024 }),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      assertAllowedContentType: jest.fn(),
      assertWithinSizeLimit: jest.fn(),
      extensionFor: jest.fn().mockReturnValue('png'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: { db } },
        { provide: AuthorizationService, useValue: authorization },
        { provide: SpecialtyCatalogService, useValue: specialties },
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: StorageService, useValue: storage },
        {
          provide: authConfig.KEY,
          useValue: { freeTrialDays: 14 },
        },
      ],
    }).compile();

    service = module.get(OrganizationsService);
  });

  describe('getOrganization', () => {
    it('asserts member access (not manage) and flattens specialty links', async () => {
      db.organization.findFirst.mockResolvedValue({
        id: ORG_ID,
        name: 'Clinic',
        status: 'ACTIVE',
        specialty_links: [{ specialty: specialtyRow }],
      });

      const result = await service.getOrganization(PROFILE_ID, ORG_ID);

      expect(authorization.assertCanAccessOrganization).toHaveBeenCalledWith(
        PROFILE_ID,
        ORG_ID,
      );
      expect(authorization.assertCanManageOrganization).not.toHaveBeenCalled();
      expect(result.specialties).toEqual([
        { id: 'spec-uuid', code: 'OBGYN', name: 'Gynecology' },
      ]);
      expect(result).not.toHaveProperty('specialty_links');
    });

    it('throws NotFound when the organization is missing', async () => {
      db.organization.findFirst.mockResolvedValue(null);
      await expect(
        service.getOrganization(PROFILE_ID, ORG_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listOrganizationSpecialties', () => {
    it('asserts access and maps to summaries', async () => {
      db.organizationSpecialty.findMany.mockResolvedValue([
        { specialty: specialtyRow },
      ]);
      const result = await service.listOrganizationSpecialties(
        PROFILE_ID,
        ORG_ID,
      );
      expect(authorization.assertCanAccessOrganization).toHaveBeenCalledWith(
        PROFILE_ID,
        ORG_ID,
      );
      expect(result).toEqual([
        { id: 'spec-uuid', code: 'OBGYN', name: 'Gynecology' },
      ]);
    });
  });

  describe('createOrganization', () => {
    function wireHappyPath() {
      specialties.resolveByCodeOrName.mockResolvedValue([specialtyRow]);
      db.role.findUnique.mockResolvedValue({ id: 'role-id', code: 'OWNER' });
      db.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan-id' });
      const tx = {
        organization: {
          create: jest.fn().mockResolvedValue({
            id: ORG_ID,
            name: 'Clinic',
            status: 'ACTIVE',
          }),
        },
        branch: {
          create: jest.fn().mockResolvedValue({
            id: 'branch-id',
            name: 'Main',
            city: 'Cairo',
            governorate: 'Cairo',
            is_main: true,
          }),
        },
        profile: { create: jest.fn().mockResolvedValue({ id: PROFILE_ID }) },
        subscription: { create: jest.fn().mockResolvedValue({}) },
      };
      db.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) =>
        fn(tx),
      );
      return tx;
    }

    it('enforces the org limit, validates specialties, and returns the result shape', async () => {
      const tx = wireHappyPath();

      const result = await service.createOrganization(USER_ID, {
        organization_name: 'Clinic',
        specialties: ['OBGYN'],
        branch_name: 'Main',
        branch_address: '1 St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
      });

      expect(subscriptions.assertOrganizationLimit).toHaveBeenCalledWith(
        USER_ID,
      );
      expect(specialties.resolveByCodeOrName).toHaveBeenCalledWith(['OBGYN'], {
        validate: true,
      });
      expect(db.role.findUnique).toHaveBeenCalledWith({
        where: { code: 'OWNER' },
      });
      expect(tx.subscription.create).toHaveBeenCalled();
      expect(result).toEqual({
        organization: {
          id: ORG_ID,
          name: 'Clinic',
          specialties: [{ id: 'spec-uuid', code: 'OBGYN', name: 'Gynecology' }],
          status: 'ACTIVE',
        },
        profile: {
          id: PROFILE_ID,
          roles: ['OWNER'],
          branch: {
            id: 'branch-id',
            name: 'Main',
            city: 'Cairo',
            governorate: 'Cairo',
            is_main: true,
          },
        },
      });
    });

    it('throws 500 when the OWNER role is not seeded', async () => {
      specialties.resolveByCodeOrName.mockResolvedValue([]);
      db.role.findUnique.mockResolvedValue(null);
      db.subscriptionPlan.findUnique.mockResolvedValue({ id: 'plan-id' });

      await expect(
        service.createOrganization(USER_ID, {
          organization_name: 'Clinic',
          branch_name: 'Main',
          branch_address: '1 St',
          branch_city: 'Cairo',
          branch_governorate: 'Cairo',
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('updateOrganization', () => {
    it('requires manage rights and replaces the specialty set when provided', async () => {
      specialties.resolveByCodeOrName.mockResolvedValue([specialtyRow]);
      const tx = {
        organization: {
          update: jest.fn().mockResolvedValue({}),
          findFirst: jest.fn().mockResolvedValue({
            id: ORG_ID,
            name: 'Renamed',
            status: 'ACTIVE',
            specialty_links: [{ specialty: specialtyRow }],
          }),
        },
        organizationSpecialty: {
          deleteMany: jest.fn().mockResolvedValue({}),
          createMany: jest.fn().mockResolvedValue({}),
        },
      };
      db.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) =>
        fn(tx),
      );

      const result = await service.updateOrganization(PROFILE_ID, ORG_ID, {
        name: 'Renamed',
        specialties: ['OBGYN'],
      });

      expect(authorization.assertCanManageOrganization).toHaveBeenCalledWith(
        PROFILE_ID,
        ORG_ID,
      );
      expect(tx.organizationSpecialty.deleteMany).toHaveBeenCalled();
      expect(tx.organizationSpecialty.createMany).toHaveBeenCalled();
      expect(result.specialties).toEqual([
        { id: 'spec-uuid', code: 'OBGYN', name: 'Gynecology' },
      ]);
    });
  });

  describe('deleteOrganization', () => {
    it('throws NotFound when the org is already gone', async () => {
      db.organization.findFirst.mockResolvedValue(null);
      await expect(
        service.deleteOrganization(PROFILE_ID, ORG_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cancels subscriptions/invitations and revokes org-scoped tokens', async () => {
      db.organization.findFirst.mockResolvedValue({ id: ORG_ID });
      const tx = {
        profile: {
          findMany: jest.fn().mockResolvedValue([{ user_id: USER_ID }]),
          updateMany: jest.fn().mockResolvedValue({}),
          count: jest.fn().mockResolvedValue(0),
        },
        branch: { updateMany: jest.fn().mockResolvedValue({}) },
        subscription: { updateMany: jest.fn().mockResolvedValue({}) },
        invitation: { updateMany: jest.fn().mockResolvedValue({}) },
        user: { updateMany: jest.fn().mockResolvedValue({}) },
        refreshToken: { updateMany: jest.fn().mockResolvedValue({}) },
        organization: { update: jest.fn().mockResolvedValue({}) },
      };
      db.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) =>
        fn(tx),
      );

      await service.deleteOrganization(PROFILE_ID, ORG_ID);

      expect(authorization.assertCanManageOrganization).toHaveBeenCalledWith(
        PROFILE_ID,
        ORG_ID,
      );
      expect(tx.subscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            is_deleted: true,
            status: 'CANCELLED',
          }),
        }),
      );
      expect(tx.invitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING' }),
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
      // Orphaned user (count=0 elsewhere) gets soft-deleted.
      expect(tx.user.updateMany).toHaveBeenCalled();
      // Token revocation is scoped to the org (plus orphaned users).
      const tokenCall = tx.refreshToken.updateMany.mock.calls[0][0];
      expect(tokenCall.where.OR).toEqual(
        expect.arrayContaining([{ organization_id: ORG_ID }]),
      );
      expect(tx.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORG_ID },
          data: expect.objectContaining({ is_deleted: true }),
        }),
      );
    });
  });
});
