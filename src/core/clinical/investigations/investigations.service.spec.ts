import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { StorageService } from '@infrastructure/storage/storage.service.js';
import type { PatientAccessService } from '@core/patient/patient-access/patient-access.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { InvestigationsService } from './investigations.service.js';

describe('InvestigationsService', () => {
  let service: InvestigationsService;
  let findFirst: jest.Mock;
  let update: jest.Mock;
  let assertVisitInOrg: jest.Mock;
  let createPresignedDownloadUrl: jest.Mock;

  const user: AuthContext = {
    userId: 'u1',
    profileId: 'doc-1',
    organizationId: 'org-1',
    roles: ['STAFF'],
    branchIds: [],
  };

  const fullRow = (over: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    status: 'RESULTED',
    test_category: 'LAB',
    custom_test_name: null,
    notes: 'Routine antenatal screening',
    result_text: null,
    updated_at: new Date('2026-06-05T10:00:00Z'),
    visit_id: 'v1',
    lab_test: { name: 'CBC' },
    visit: {
      episode: { journey: { patient: { full_name: 'Asmaa Mohamed Ali' } } },
    },
    result_attachments: [
      {
        id: 'att-1',
        object_key: 'investigations/inv-1/results/x.png',
        content_type: 'image/png',
      },
    ],
    ...over,
  });

  beforeEach(() => {
    findFirst = jest.fn();
    update = jest.fn();
    assertVisitInOrg = jest.fn().mockResolvedValue({ id: 'v1' });
    createPresignedDownloadUrl = jest
      .fn()
      .mockImplementation((key: string) => Promise.resolve(`signed:${key}`));
    const prisma = {
      db: { visitInvestigation: { findFirst, update } },
    } as unknown as PrismaService;
    service = new InvestigationsService(
      prisma,
      { createPresignedDownloadUrl } as unknown as StorageService,
      { assertVisitInOrg } as unknown as PatientAccessService,
    );
  });

  describe('getReview', () => {
    it('maps the investigation and presigns its result files', async () => {
      findFirst.mockResolvedValue(fullRow());

      const dto = await service.getReview('inv-1', user);

      expect(assertVisitInOrg).toHaveBeenCalledWith('v1', user);
      expect(dto).toMatchObject({
        id: 'inv-1',
        patient_name: 'Asmaa Mohamed Ali',
        visit_id: 'v1',
        status: 'RESULTED',
        type: 'LAB',
        test_name: 'CBC',
        reason: 'Routine antenatal screening',
        doctor_notes: null,
      });
      expect(dto.result_attachments[0].url).toBe(
        'signed:investigations/inv-1/results/x.png',
      );
    });

    it('throws 404 when the investigation does not exist', async () => {
      findFirst.mockResolvedValue(null);
      await expect(service.getReview('inv-9', user)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(assertVisitInOrg).not.toHaveBeenCalled();
    });

    it('rejects when the visit is not in the caller’s org', async () => {
      findFirst.mockResolvedValue(fullRow());
      assertVisitInOrg.mockRejectedValue(
        new NotFoundException('Visit not found'),
      );
      await expect(service.getReview('inv-1', user)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('review', () => {
    it('marks REVIEWED, records the doctor + notes, and bumps version', async () => {
      findFirst.mockResolvedValue({ id: 'inv-1', visit_id: 'v1' });
      update.mockResolvedValue(
        fullRow({ status: 'REVIEWED', result_text: 'Looks normal.' }),
      );

      const dto = await service.review('inv-1', user, {
        notes: 'Looks normal.',
      });

      expect(assertVisitInOrg).toHaveBeenCalledWith('v1', user);
      const data = update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.status).toBe('REVIEWED');
      expect(data.reviewed_by_id).toBe('doc-1');
      expect(data.reviewed_at).toBeInstanceOf(Date);
      expect(data.result_text).toBe('Looks normal.');
      expect(data.version).toEqual({ increment: 1 });

      expect(dto.status).toBe('REVIEWED');
      expect(dto.doctor_notes).toBe('Looks normal.');
    });

    it('throws 404 when the investigation does not exist', async () => {
      findFirst.mockResolvedValue(null);
      await expect(
        service.review('inv-9', user, { notes: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(update).not.toHaveBeenCalled();
    });
  });
});
