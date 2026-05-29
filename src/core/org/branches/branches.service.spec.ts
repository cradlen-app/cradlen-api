import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BranchesService } from './branches.service';
import { BRANCH_EVENTS } from './branches.events';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { AuthorizationService } from '@core/auth/authorization/authorization.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

const ORG = 'org-uuid';
const PROFILE = 'profile-uuid';
const BRANCH = 'branch-uuid';

function makeBranch(overrides: Record<string, unknown> = {}) {
  return {
    id: BRANCH,
    name: 'Main Branch',
    address: '1 St',
    city: 'Cairo',
    governorate: 'Cairo',
    country: 'EG',
    is_main: false,
    status: 'ACTIVE',
    is_deleted: false,
    deleted_at: null,
    organization_id: ORG,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-02'),
    ...overrides,
  };
}

describe('BranchesService', () => {
  let service: BranchesService;
  let db: {
    branch: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    profileBranch: { deleteMany: jest.Mock };
    workingSchedule: { deleteMany: jest.Mock };
    calendarEvent: { updateMany: jest.Mock };
    visit: { count: jest.Mock };
    medicalRepVisit: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let auth: Record<string, jest.Mock>;
  let subs: { assertBranchLimit: jest.Mock };
  let orgs: { deleteOrganization: jest.Mock };
  let eventBus: { publish: jest.Mock };

  beforeEach(async () => {
    db = {
      branch: {
        findMany: jest.fn().mockResolvedValue([makeBranch()]),
        findFirst: jest.fn().mockResolvedValue(makeBranch()),
        count: jest.fn().mockResolvedValue(2),
        create: jest.fn().mockResolvedValue(makeBranch()),
        update: jest.fn().mockResolvedValue(makeBranch()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      profileBranch: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      workingSchedule: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      calendarEvent: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      visit: { count: jest.fn().mockResolvedValue(0) },
      medicalRepVisit: { count: jest.fn().mockResolvedValue(0) },
      // Supports both array form ($transaction([p1, p2])) and callback form.
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(db)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    };
    auth = {
      assertCanManageOrganization: jest.fn().mockResolvedValue(undefined),
      assertCanManageBranch: jest.fn().mockResolvedValue(undefined),
      isOwner: jest.fn().mockResolvedValue(true),
      canManageStaff: jest.fn().mockResolvedValue(true),
      getEffectiveBranchIds: jest.fn().mockResolvedValue([BRANCH]),
    };
    subs = { assertBranchLimit: jest.fn().mockResolvedValue(undefined) };
    orgs = { deleteOrganization: jest.fn().mockResolvedValue(undefined) };
    eventBus = { publish: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchesService,
        { provide: PrismaService, useValue: { db } },
        { provide: AuthorizationService, useValue: auth },
        { provide: SubscriptionsService, useValue: subs },
        { provide: OrganizationsService, useValue: orgs },
        { provide: EventBus, useValue: eventBus },
      ],
    }).compile();

    service = module.get(BranchesService);
  });

  describe('listBranches', () => {
    it('returns paginated branches without internal columns for an owner', async () => {
      const result = await service.listBranches(PROFILE, ORG, {});
      expect(db.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organization_id: ORG, is_deleted: false },
        }),
      );
      const items = (result as { items: Record<string, unknown>[] }).items;
      expect(items[0]).not.toHaveProperty('is_deleted');
      expect(items[0]).not.toHaveProperty('organization_id');
    });

    it('scopes a branch manager to their effective branches', async () => {
      auth.isOwner.mockResolvedValue(false);
      await service.listBranches(PROFILE, ORG, {});
      expect(db.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: [BRANCH] } }),
        }),
      );
    });

    it('rejects a non-manager', async () => {
      auth.isOwner.mockResolvedValue(false);
      auth.canManageStaff.mockResolvedValue(false);
      await expect(service.listBranches(PROFILE, ORG, {})).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('createBranch', () => {
    it('demotes existing mains and publishes branch.created', async () => {
      db.branch.create.mockResolvedValue(makeBranch({ is_main: true }));
      await service.createBranch(PROFILE, ORG, {
        name: 'B',
        address: 'a',
        city: 'c',
        governorate: 'g',
        is_main: true,
      });
      expect(subs.assertBranchLimit).toHaveBeenCalledWith(ORG, db);
      expect(db.branch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ is_main: true }),
          data: { is_main: false },
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        BRANCH_EVENTS.created,
        expect.objectContaining({ organization_id: ORG }),
      );
    });

    it('propagates the plan limit error', async () => {
      subs.assertBranchLimit.mockRejectedValue(new ForbiddenException());
      await expect(
        service.createBranch(PROFILE, ORG, {
          name: 'B',
          address: 'a',
          city: 'c',
          governorate: 'g',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getBranch', () => {
    it('throws 404 when missing', async () => {
      db.branch.findFirst.mockResolvedValue(null);
      await expect(service.getBranch(PROFILE, ORG, BRANCH)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateBranch', () => {
    it('blocks demoting the only main', async () => {
      db.branch.findFirst.mockResolvedValue(makeBranch({ is_main: true }));
      await expect(
        service.updateBranch(PROFILE, ORG, BRANCH, { is_main: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('demotes other mains when promoting this branch', async () => {
      await service.updateBranch(PROFILE, ORG, BRANCH, { is_main: true });
      expect(db.branch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: BRANCH } }),
        }),
      );
    });
  });

  describe('deleteBranch', () => {
    it('soft-deletes a regular branch and detaches dependents', async () => {
      db.branch.count.mockResolvedValue(2);
      db.branch.findFirst.mockResolvedValue(makeBranch({ is_main: false }));
      await service.deleteBranch(PROFILE, ORG, BRANCH);

      expect(orgs.deleteOrganization).not.toHaveBeenCalled();
      expect(db.profileBranch.deleteMany).toHaveBeenCalledWith({
        where: { branch_id: BRANCH, organization_id: ORG },
      });
      expect(db.workingSchedule.deleteMany).toHaveBeenCalledWith({
        where: { branch_id: BRANCH },
      });
      expect(db.calendarEvent.updateMany).toHaveBeenCalledWith({
        where: { branch_id: BRANCH },
        data: { branch_id: null },
      });
      expect(eventBus.publish).toHaveBeenCalledWith(
        BRANCH_EVENTS.deleted,
        expect.objectContaining({ id: BRANCH, organization_id: ORG }),
      );
      expect(eventBus.publish).not.toHaveBeenCalledWith(
        BRANCH_EVENTS.deleted,
        expect.objectContaining({ organization_deleted: true }),
      );
    });

    it('promotes the oldest sibling when deleting a main branch', async () => {
      db.branch.count.mockResolvedValue(2);
      db.branch.findFirst
        .mockResolvedValueOnce(makeBranch({ is_main: true })) // getBranchOrThrow
        .mockResolvedValueOnce(makeBranch({ id: 'sibling', is_main: false })); // oldest
      await service.deleteBranch(PROFILE, ORG, BRANCH);
      expect(db.branch.update).toHaveBeenCalledWith({
        where: { id: 'sibling' },
        data: { is_main: true },
      });
    });

    it('tears down the organization when deleting the last branch', async () => {
      db.branch.count.mockResolvedValue(1);
      await service.deleteBranch(PROFILE, ORG, BRANCH);
      expect(orgs.deleteOrganization).toHaveBeenCalledWith(PROFILE, ORG);
      expect(eventBus.publish).toHaveBeenCalledWith(
        BRANCH_EVENTS.deleted,
        expect.objectContaining({ organization_deleted: true }),
      );
    });

    it('refuses to delete a branch with open visits', async () => {
      db.branch.count.mockResolvedValue(2);
      db.visit.count.mockResolvedValue(3);
      await expect(service.deleteBranch(PROFILE, ORG, BRANCH)).rejects.toThrow(
        ConflictException,
      );
      expect(db.profileBranch.deleteMany).not.toHaveBeenCalled();
    });
  });
});
