import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { StorageService } from '@infrastructure/storage/storage.service.js';
import type { EventBus } from '@infrastructure/messaging/event-bus.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientInvestigationResultsService } from './patient-investigation-results.service.js';

describe('PatientInvestigationResultsService', () => {
  let service: PatientInvestigationResultsService;
  let findFirst: jest.Mock; // visitInvestigation.findFirst (access check)
  let findUnique: jest.Mock; // visitInvestigation.findUnique (event payload)
  let attachmentCount: jest.Mock;
  let attachmentFindFirst: jest.Mock;
  let txAttachmentCreate: jest.Mock;
  let txAttachmentUpdate: jest.Mock;
  let txInvestigationUpdate: jest.Mock;
  let publish: jest.Mock;
  let storage: {
    assertAllowedContentType: jest.Mock;
    assertWithinSizeLimit: jest.Mock;
    extensionFor: jest.Mock;
    createPresignedUploadUrl: jest.Mock;
    createPresignedDownloadUrl: jest.Mock;
    deleteObject: jest.Mock;
    headObject: jest.Mock;
  };

  const ctx: PatientAuthContext = {
    accountId: 'u1',
    patientId: 'p1',
    accessiblePatientIds: ['p1'],
  };

  const accessibleRow = (status = 'ORDERED', result_source = 'CLINIC') => ({
    id: 'inv-1',
    status,
    result_source,
  });

  /** A mapped-shape investigation row returned by the tx update (with include). */
  const investigationRow = (over: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    visit_id: 'v1',
    custom_test_name: null,
    test_category: 'LAB',
    notes: null,
    status: 'RESULTED',
    result_source: 'PATIENT',
    result_text: null,
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
    result_attachments: [
      {
        id: 'att-1',
        object_key: 'investigations/inv-1/results/x.pdf',
        content_type: 'application/pdf',
        created_at: new Date(),
        source: 'PATIENT',
      },
    ],
    ...over,
  });

  beforeEach(() => {
    findFirst = jest.fn().mockResolvedValue(accessibleRow());
    attachmentCount = jest.fn().mockResolvedValue(0);
    attachmentFindFirst = jest.fn();
    txAttachmentCreate = jest.fn().mockResolvedValue({});
    txAttachmentUpdate = jest.fn().mockResolvedValue({});
    txInvestigationUpdate = jest.fn().mockResolvedValue(investigationRow());
    findUnique = jest.fn().mockResolvedValue({
      ordered_by_id: 'doc-1',
      visit_id: 'v1',
      custom_test_name: null,
      lab_test: { name: 'CBC' },
      visit: {
        branch_id: 'b1',
        episode: {
          journey: {
            organization_id: 'org-1',
            patient: { id: 'p1', full_name: 'Ebtesam Alaa' },
          },
        },
      },
    });
    publish = jest.fn();
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
      deleteObject: jest.fn().mockResolvedValue(undefined),
      headObject: jest.fn().mockResolvedValue({
        contentType: 'application/pdf',
        contentLength: 100,
      }),
    };
    const tx = {
      visitInvestigationAttachment: {
        create: txAttachmentCreate,
        update: txAttachmentUpdate,
      },
      visitInvestigation: { update: txInvestigationUpdate },
    };
    const prisma = {
      db: {
        visitInvestigation: { findFirst, findUnique },
        visitInvestigationAttachment: {
          count: attachmentCount,
          findFirst: attachmentFindFirst,
        },
        $transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
      },
    } as unknown as PrismaService;
    service = new PatientInvestigationResultsService(
      prisma,
      storage as unknown as StorageService,
      { publish } as unknown as EventBus,
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
          { accountId: 'u1', accessiblePatientIds: [] },
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
    });

    it('rejects (409) when the investigation is closed (REVIEWED)', async () => {
      findFirst.mockResolvedValue(accessibleRow('REVIEWED'));
      await expect(
        service.createUploadUrl(ctx, 'inv-1', {
          content_type: 'application/pdf',
          size_bytes: 100,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(storage.createPresignedUploadUrl).not.toHaveBeenCalled();
    });
  });

  describe('confirmResult', () => {
    const validKey = 'investigations/inv-1/results/x.pdf';

    it('rejects a key not scoped to the investigation', async () => {
      await expect(
        service.confirmResult(ctx, 'inv-1', {
          key: 'investigations/other/results/x.pdf',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(txAttachmentCreate).not.toHaveBeenCalled();
    });

    it('rejects when the object did not land in R2', async () => {
      storage.headObject.mockResolvedValue(null);
      await expect(
        service.confirmResult(ctx, 'inv-1', { key: validKey }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(txAttachmentCreate).not.toHaveBeenCalled();
    });

    it('rejects (409) when the attachment cap is reached', async () => {
      attachmentCount.mockResolvedValue(10);
      await expect(
        service.confirmResult(ctx, 'inv-1', { key: validKey }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(txAttachmentCreate).not.toHaveBeenCalled();
    });

    it('appends a PATIENT attachment and advances ORDERED -> RESULTED', async () => {
      const dto = await service.confirmResult(ctx, 'inv-1', {
        key: validKey,
        result_text: 'my lab',
      });

      const attData = txAttachmentCreate.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(attData.object_key).toBe(validKey);
      expect(attData.source).toBe('PATIENT');
      expect(attData.content_type).toBe('application/pdf');

      const invData = txInvestigationUpdate.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(invData.result_source).toBe('PATIENT');
      expect(invData.resulted_at).toBeInstanceOf(Date);
      expect(invData.status).toBe('RESULTED');
      expect(invData.result_text).toBe('my lab');
      expect(invData.version).toEqual({ increment: 1 });

      // Returned dto carries a presigned attachment URL.
      expect(dto.result_attachments[0].url).toBe(`signed:${validKey}`);

      // Notifies the ordering doctor once on the first upload.
      expect(publish).toHaveBeenCalledWith(
        'investigation.result_uploaded',
        expect.objectContaining({
          ordered_by_id: 'doc-1',
          patient_name: 'Ebtesam Alaa',
          test_name: 'CBC',
          visit_id: 'v1',
          organization_id: 'org-1',
        }),
      );
    });

    it('rejects (409) overwriting an already-REVIEWED result', async () => {
      findFirst.mockResolvedValue(accessibleRow('REVIEWED'));
      await expect(
        service.confirmResult(ctx, 'inv-1', { key: validKey }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(txAttachmentCreate).not.toHaveBeenCalled();
    });

    it('rejects (409) adding to a clinic-recorded result', async () => {
      findFirst.mockResolvedValue(accessibleRow('RESULTED', 'CLINIC'));
      await expect(
        service.confirmResult(ctx, 'inv-1', { key: validKey }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("allows adding to the patient's own not-yet-reviewed result without re-setting status, and does not re-notify", async () => {
      findFirst.mockResolvedValue(accessibleRow('RESULTED', 'PATIENT'));
      await service.confirmResult(ctx, 'inv-1', { key: validKey });
      const invData = txInvestigationUpdate.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(invData.status).toBeUndefined();
      // Subsequent files (already RESULTED) don't re-notify the doctor.
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('removeAttachment', () => {
    it('rejects (409) when the investigation is REVIEWED', async () => {
      findFirst.mockResolvedValue(accessibleRow('REVIEWED'));
      await expect(
        service.removeAttachment(ctx, 'inv-1', 'att-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(attachmentFindFirst).not.toHaveBeenCalled();
    });

    it('throws 404 when the attachment is not the patient’s own', async () => {
      findFirst.mockResolvedValue(accessibleRow('RESULTED', 'PATIENT'));
      attachmentFindFirst.mockResolvedValue(null);
      await expect(
        service.removeAttachment(ctx, 'inv-1', 'att-x'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft-deletes the row and best-effort deletes the R2 object', async () => {
      findFirst.mockResolvedValue(accessibleRow('RESULTED', 'PATIENT'));
      attachmentFindFirst.mockResolvedValue({
        id: 'att-1',
        object_key: 'investigations/inv-1/results/x.pdf',
      });

      await service.removeAttachment(ctx, 'inv-1', 'att-1');

      const data = txAttachmentUpdate.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.is_deleted).toBe(true);
      expect(data.deleted_at).toBeInstanceOf(Date);
      expect(storage.deleteObject).toHaveBeenCalledWith(
        'investigations/inv-1/results/x.pdf',
      );
    });
  });
});
