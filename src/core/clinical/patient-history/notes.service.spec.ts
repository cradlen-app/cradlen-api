import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotesService } from './notes.service';
import { PatientAccessService } from './patient-access.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';

const callerOrg = 'org-A';
const otherOrg = 'org-B';

const mockUser: AuthContext = {
  userId: 'user-uuid',
  profileId: 'profile-A',
  organizationId: callerOrg,
  activeBranchId: 'branch-uuid',
  roles: ['OBGYN'],
  branchIds: ['branch-uuid'],
};

describe('NotesService', () => {
  let service: NotesService;
  let db: {
    patientHistoryNote: {
      findMany: jest.Mock;
      groupBy: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    organization: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    db = {
      patientHistoryNote: {
        findMany: jest.fn(),
        groupBy: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      organization: { findMany: jest.fn() },
    };
    const access = { assertPatientInOrg: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: PrismaService, useValue: { db } },
        { provide: PatientAccessService, useValue: access },
      ],
    }).compile();
    service = module.get<NotesService>(NotesService);
  });

  describe('list — visibility filter', () => {
    it('returns own-org notes (any visibility) + foreign-org SHARED_GLOBAL', async () => {
      const visible = [
        {
          id: 'n1',
          organization_id: callerOrg,
          visibility: 'PRIVATE_TO_ORG',
          section_code: 'MENSTRUAL',
        },
        {
          id: 'n2',
          organization_id: callerOrg,
          visibility: 'SHARED_GLOBAL',
          section_code: 'MENSTRUAL',
        },
        {
          id: 'n3',
          organization_id: otherOrg,
          visibility: 'SHARED_GLOBAL',
          section_code: 'MEDICAL',
        },
      ];
      db.patientHistoryNote.findMany.mockResolvedValue(visible);
      db.patientHistoryNote.groupBy.mockResolvedValue([]);
      db.organization.findMany.mockResolvedValue([]);

      const result = await service.list('patient-uuid', undefined, mockUser);
      expect(result.visible).toEqual(visible);
      expect(result.redacted_by_org).toEqual([]);

      const where = db.patientHistoryNote.findMany.mock.calls[0][0].where;
      expect(where.OR).toContainEqual({ organization_id: callerOrg });
      expect(where.OR).toContainEqual({ visibility: 'SHARED_GLOBAL' });
    });

    it('returns redacted_by_org placeholders for foreign-org PRIVATE_TO_ORG notes', async () => {
      db.patientHistoryNote.findMany.mockResolvedValue([]);
      db.patientHistoryNote.groupBy.mockResolvedValue([
        {
          organization_id: otherOrg,
          section_code: 'MENSTRUAL',
          _count: { _all: 3 },
        },
        {
          organization_id: 'org-C',
          section_code: 'MEDICAL',
          _count: { _all: 1 },
        },
      ]);
      db.organization.findMany.mockResolvedValue([
        { id: otherOrg, name: 'Clinic B' },
        { id: 'org-C', name: 'Clinic C' },
      ]);

      const result = await service.list('patient-uuid', undefined, mockUser);
      expect(result.redacted_by_org).toEqual([
        {
          organization_id: otherOrg,
          organization_name: 'Clinic B',
          section_code: 'MENSTRUAL',
          count: 3,
        },
        {
          organization_id: 'org-C',
          organization_name: 'Clinic C',
          section_code: 'MEDICAL',
          count: 1,
        },
      ]);

      const groupByWhere = db.patientHistoryNote.groupBy.mock.calls[0][0].where;
      expect(groupByWhere.NOT).toEqual({ organization_id: callerOrg });
      expect(groupByWhere.visibility).toBe('PRIVATE_TO_ORG');
    });

    it('falls back to "Unknown" when org name lookup misses', async () => {
      db.patientHistoryNote.findMany.mockResolvedValue([]);
      db.patientHistoryNote.groupBy.mockResolvedValue([
        {
          organization_id: 'ghost-org',
          section_code: 'FAMILY',
          _count: { _all: 2 },
        },
      ]);
      db.organization.findMany.mockResolvedValue([]);

      const result = await service.list('patient-uuid', undefined, mockUser);
      expect(result.redacted_by_org[0].organization_name).toBe('Unknown');
    });

    it('passes section filter through to both queries', async () => {
      db.patientHistoryNote.findMany.mockResolvedValue([]);
      db.patientHistoryNote.groupBy.mockResolvedValue([]);
      db.organization.findMany.mockResolvedValue([]);

      await service.list('patient-uuid', 'MEDICAL', mockUser);
      expect(
        db.patientHistoryNote.findMany.mock.calls[0][0].where.section_code,
      ).toBe('MEDICAL');
      expect(
        db.patientHistoryNote.groupBy.mock.calls[0][0].where.section_code,
      ).toBe('MEDICAL');
    });
  });

  describe('create', () => {
    it('defaults visibility to PRIVATE_TO_ORG', async () => {
      db.patientHistoryNote.create.mockResolvedValue({ id: 'n1' });
      await service.create(
        'patient-uuid',
        { section_code: 'MEDICAL', content: 'Anxious patient' },
        mockUser,
      );
      const call = db.patientHistoryNote.create.mock.calls[0][0];
      expect(call.data.visibility).toBe('PRIVATE_TO_ORG');
      expect(call.data.organization_id).toBe(callerOrg);
      expect(call.data.author_id).toBe('profile-A');
    });

    it('honors explicit SHARED_GLOBAL', async () => {
      db.patientHistoryNote.create.mockResolvedValue({ id: 'n1' });
      await service.create(
        'patient-uuid',
        {
          section_code: 'MEDICAL',
          content: 'Patient is allergic to penicillin',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          visibility: 'SHARED_GLOBAL' as any,
        },
        mockUser,
      );
      expect(
        db.patientHistoryNote.create.mock.calls[0][0].data.visibility,
      ).toBe('SHARED_GLOBAL');
    });
  });

  describe('update — author-only', () => {
    it('rejects when the editor is not the author', async () => {
      db.patientHistoryNote.findUnique.mockResolvedValue({
        id: 'n1',
        organization_id: callerOrg,
        author_id: 'other-profile',
        visibility: 'PRIVATE_TO_ORG',
        patient_id: 'patient-uuid',
      });
      await expect(
        service.update('n1', { content: 'edited' }, mockUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('hides foreign-org private notes (returns 404)', async () => {
      db.patientHistoryNote.findUnique.mockResolvedValue({
        id: 'n1',
        organization_id: otherOrg,
        author_id: 'profile-A',
        visibility: 'PRIVATE_TO_ORG',
        patient_id: 'patient-uuid',
      });
      await expect(
        service.update('n1', { content: 'edited' }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows author to toggle visibility', async () => {
      db.patientHistoryNote.findUnique.mockResolvedValue({
        id: 'n1',
        organization_id: callerOrg,
        author_id: 'profile-A',
        visibility: 'PRIVATE_TO_ORG',
        patient_id: 'patient-uuid',
      });
      db.patientHistoryNote.update.mockResolvedValue({ id: 'n1' });
      await service.update(
        'n1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { visibility: 'SHARED_GLOBAL' as any },
        mockUser,
      );
      expect(
        db.patientHistoryNote.update.mock.calls[0][0].data.visibility,
      ).toBe('SHARED_GLOBAL');
    });
  });
});
