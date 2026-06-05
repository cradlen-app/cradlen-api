import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { StorageService } from '@infrastructure/storage/storage.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientInvestigationResultsService } from './patient-investigation-results.service.js';

describe('PatientInvestigationResultsService', () => {
  let service: PatientInvestigationResultsService;
  let findFirst: jest.Mock;
  let update: jest.Mock;
  let storage: {
    assertAllowedContentType: jest.Mock;
    assertWithinSizeLimit: jest.Mock;
    extensionFor: jest.Mock;
    createPresignedUploadUrl: jest.Mock;
    createPresignedDownloadUrl: jest.Mock;
    headObject: jest.Mock;
  };

  const ctx: PatientAuthContext = {
    userId: 'u1',
    patientId: 'p1',
    accessiblePatientIds: ['p1'],
  };

  const accessibleRow = (status = 'ORDERED') => ({ id: 'inv-1', status });

  beforeEach(() => {
    findFirst = jest.fn().mockResolvedValue(accessibleRow());
    update = jest.fn();
    storage = {
      assertAllowedContentType: jest.fn(),
      assertWithinSizeLimit: jest.fn(),
      extensionFor: jest.fn().mockReturnValue('pdf'),
      createPresignedUploadUrl: jest
        .fn()
        .mockResolvedValue({ url: 'https://r2/put', expiresIn: 300 }),
      createPresignedDownloadUrl: jest
        .fn()
        .mockImplementation((key: string) => Promise.resolve(`signed:${key}`)),
      headObject: jest.fn().mockResolvedValue({
        contentType: 'application/pdf',
        contentLength: 100,
      }),
    };
    const prisma = {
      db: { visitInvestigation: { findFirst, update } },
    } as unknown as PrismaService;
    service = new PatientInvestigationResultsService(
      prisma,
      storage as unknown as StorageService,
    );
  });

  describe('createUploadUrl', () => {
    it('throws 404 for an investigation the caller cannot access', async () => {
      findFirst.mockResolvedValue(null);
      await expect(
        service.createUploadUrl(ctx, 'inv-1', {
          content_type: 'application/pdf',
          size_bytes: 100,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when no accessible patients', async () => {
      await expect(
        service.createUploadUrl(
          { userId: 'u1', accessiblePatientIds: [] },
          'inv-1',
          { content_type: 'application/pdf', size_bytes: 100 },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propagates content-type / size validation failures', async () => {
      storage.assertAllowedContentType.mockImplementation(() => {
        throw new BadRequestException('Unsupported file type');
      });
      await expect(
        service.createUploadUrl(ctx, 'inv-1', {
          content_type: 'text/html',
          size_bytes: 100,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns a presigned url and an investigation-scoped key', async () => {
      const res = await service.createUploadUrl(ctx, 'inv-1', {
        content_type: 'application/pdf',
        size_bytes: 100,
      });
      expect(res.upload_url).toBe('https://r2/put');
      expect(res.key.startsWith('investigations/inv-1/results/')).toBe(true);
      expect(res.key.endsWith('.pdf')).toBe(true);
      expect(res.content_type).toBe('application/pdf');
    });
  });

  describe('confirmResult', () => {
    it('rejects a key not scoped to the investigation', async () => {
      await expect(
        service.confirmResult(ctx, 'inv-1', {
          key: 'investigations/other/results/x.pdf',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(update).not.toHaveBeenCalled();
    });

    it('rejects when the object did not land in R2', async () => {
      storage.headObject.mockResolvedValue(null);
      await expect(
        service.confirmResult(ctx, 'inv-1', {
          key: 'investigations/inv-1/results/x.pdf',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(update).not.toHaveBeenCalled();
    });

    it('records the result as PATIENT-sourced and advances ORDERED -> RESULTED', async () => {
      update.mockResolvedValue({
        id: 'inv-1',
        visit_id: 'v1',
        custom_test_name: null,
        test_category: 'LAB',
        notes: null,
        status: 'RESULTED',
        result_source: 'PATIENT',
        result_text: null,
        result_attachment_url: 'investigations/inv-1/results/x.pdf',
        reviewed_at: null,
        ordered_at: new Date(),
        lab_test: { name: 'CBC' },
        ordered_by: { user: { first_name: 'Aya', last_name: 'Hassan' } },
        reviewed_by: null,
        visit: {
          id: 'v1',
          scheduled_at: new Date(),
          branch: { name: 'Main' },
          episode: { journey: { organization: { name: 'Jasmin' } } },
        },
      });

      const dto = await service.confirmResult(ctx, 'inv-1', {
        key: 'investigations/inv-1/results/x.pdf',
        result_text: 'my lab',
      });

      const data = update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.result_attachment_url).toBe(
        'investigations/inv-1/results/x.pdf',
      );
      expect(data.result_source).toBe('PATIENT');
      expect(data.resulted_at).toBeInstanceOf(Date);
      expect(data.status).toBe('RESULTED');
      expect(data.result_text).toBe('my lab');
      expect(data.version).toEqual({ increment: 1 });

      // Patient-uploaded result is visible to them via a presigned URL.
      expect(dto.result_attachment_url).toBe(
        'signed:investigations/inv-1/results/x.pdf',
      );
    });

    it('does not change status when already REVIEWED', async () => {
      findFirst.mockResolvedValue(accessibleRow('REVIEWED'));
      update.mockResolvedValue({
        id: 'inv-1',
        visit_id: 'v1',
        custom_test_name: null,
        test_category: 'LAB',
        notes: null,
        status: 'REVIEWED',
        result_source: 'PATIENT',
        result_text: null,
        result_attachment_url: 'investigations/inv-1/results/x.pdf',
        reviewed_at: new Date(),
        ordered_at: new Date(),
        lab_test: { name: 'CBC' },
        ordered_by: { user: { first_name: 'Aya', last_name: 'Hassan' } },
        reviewed_by: null,
        visit: {
          id: 'v1',
          scheduled_at: new Date(),
          branch: { name: 'Main' },
          episode: { journey: { organization: { name: 'Jasmin' } } },
        },
      });

      await service.confirmResult(ctx, 'inv-1', {
        key: 'investigations/inv-1/results/x.pdf',
      });

      const data = update.mock.calls[0][0].data as Record<string, unknown>;
      expect(data.status).toBeUndefined();
    });
  });
});
