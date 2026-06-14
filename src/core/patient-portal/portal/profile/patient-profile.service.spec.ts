import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { StorageService } from '@infrastructure/storage/storage.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientProfileService } from './patient-profile.service.js';

describe('PatientProfileService', () => {
  let service: PatientProfileService;
  let patientFindFirst: jest.Mock;
  let patientUpdate: jest.Mock;
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
  const guardianCtx: PatientAuthContext = {
    accountId: 'u1',
    guardianId: 'g1',
    accessiblePatientIds: ['p1', 'p2'],
  };

  const patientRow = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    full_name: 'Sara Ali',
    national_id: 'NID1',
    date_of_birth: new Date('1990-01-01'),
    phone_number: '0100',
    address: 'Cairo',
    marital_status: 'SINGLE',
    profile_image_object_key: null,
    ...over,
  });

  beforeEach(() => {
    patientFindFirst = jest.fn().mockResolvedValue(patientRow());
    patientUpdate = jest.fn().mockResolvedValue(patientRow());
    storage = {
      assertAllowedContentType: jest.fn(),
      assertWithinSizeLimit: jest.fn(),
      extensionFor: jest.fn().mockReturnValue('png'),
      createPresignedUploadUrl: jest
        .fn()
        .mockResolvedValue({ url: 'https://r2/put', expiresIn: 300 }),
      createPresignedDownloadUrl: jest
        .fn()
        .mockImplementation((key: string) => Promise.resolve(`signed:${key}`)),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      headObject: jest
        .fn()
        .mockResolvedValue({ contentType: 'image/png', contentLength: 100 }),
    };
    const prisma = {
      db: {
        patient: { findFirst: patientFindFirst, update: patientUpdate },
      },
    } as unknown as PrismaService;
    service = new PatientProfileService(
      prisma,
      storage as unknown as StorageService,
    );
  });

  describe('getProfile', () => {
    it('throws 404 when the account has no accessible patients', async () => {
      await expect(
        service.getProfile({ accountId: 'u1', accessiblePatientIds: [] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(patientFindFirst).not.toHaveBeenCalled();
    });

    it('throws 400 when a guardian must disambiguate with patient_id', async () => {
      await expect(service.getProfile(guardianCtx)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(patientFindFirst).not.toHaveBeenCalled();
    });

    it('throws 404 when patient_id is not accessible', async () => {
      await expect(
        service.getProfile(guardianCtx, 'p9'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns demographics with a presigned avatar url when set', async () => {
      patientFindFirst.mockResolvedValue(
        patientRow({ profile_image_object_key: 'patients/p1/avatar/a.png' }),
      );
      const dto = await service.getProfile(ctx);
      expect(dto).toMatchObject({
        id: 'p1',
        full_name: 'Sara Ali',
        national_id: 'NID1',
        marital_status: 'SINGLE',
        profile_image_url: 'signed:patients/p1/avatar/a.png',
      });
    });

    it('returns a null avatar url when no image is set', async () => {
      const dto = await service.getProfile(ctx);
      expect(dto.profile_image_url).toBeNull();
      expect(storage.createPresignedDownloadUrl).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile', () => {
    it('updates only the provided demographic fields on the patient row', async () => {
      await service.updateProfile(ctx, undefined, {
        full_name: 'New Name',
        address: 'Giza',
      });

      const data = patientUpdate.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).toEqual({ full_name: 'New Name', address: 'Giza' });
    });

    it('writes a single supplied field without touching others', async () => {
      await service.updateProfile(ctx, undefined, { phone_number: '0999' });
      const data = patientUpdate.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).toEqual({ phone_number: '0999' });
    });
  });

  describe('createImageUploadUrl', () => {
    it('rejects a non-image content type', async () => {
      await expect(
        service.createImageUploadUrl(ctx, undefined, {
          content_type: 'application/pdf',
          size_bytes: 100,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.createPresignedUploadUrl).not.toHaveBeenCalled();
    });

    it('returns a patient-scoped key and a presigned url', async () => {
      const res = await service.createImageUploadUrl(ctx, undefined, {
        content_type: 'image/png',
        size_bytes: 100,
      });
      expect(res.upload_url).toBe('https://r2/put');
      expect(res.key.startsWith('patients/p1/avatar/')).toBe(true);
      expect(res.key.endsWith('.png')).toBe(true);
    });
  });

  describe('confirmImage', () => {
    it('rejects a key not scoped to the patient', async () => {
      await expect(
        service.confirmImage(ctx, undefined, {
          key: 'patients/p2/avatar/x.png',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(patientUpdate).not.toHaveBeenCalled();
    });

    it('rejects when the object did not land in R2', async () => {
      storage.headObject.mockResolvedValue(null);
      await expect(
        service.confirmImage(ctx, undefined, {
          key: 'patients/p1/avatar/x.png',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(patientUpdate).not.toHaveBeenCalled();
    });

    it('sets the new key and best-effort deletes the previous image', async () => {
      patientFindFirst.mockResolvedValue(
        patientRow({ profile_image_object_key: 'patients/p1/avatar/old.png' }),
      );
      await service.confirmImage(ctx, undefined, {
        key: 'patients/p1/avatar/new.png',
      });
      const data = patientUpdate.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.profile_image_object_key).toBe('patients/p1/avatar/new.png');
      expect(storage.deleteObject).toHaveBeenCalledWith(
        'patients/p1/avatar/old.png',
      );
    });
  });

  describe('removeImage', () => {
    it('clears the key and best-effort deletes the object', async () => {
      patientFindFirst.mockResolvedValue(
        patientRow({ profile_image_object_key: 'patients/p1/avatar/old.png' }),
      );
      await service.removeImage(ctx);
      const data = patientUpdate.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.profile_image_object_key).toBeNull();
      expect(storage.deleteObject).toHaveBeenCalledWith(
        'patients/p1/avatar/old.png',
      );
    });
  });
});
