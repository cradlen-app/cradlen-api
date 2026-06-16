import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EngagementType, ExecutiveTitle } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageService } from '@infrastructure/storage/storage.service';
import { ProfilesService } from './profiles.service';

describe('ProfilesService', () => {
  let service: ProfilesService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let storage: any;

  beforeEach(async () => {
    db = {
      profile: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    storage = {
      assertAllowedContentType: jest.fn(),
      assertWithinSizeLimit: jest.fn(),
      extensionFor: jest.fn().mockReturnValue('png'),
      createPresignedUploadUrl: jest
        .fn()
        .mockResolvedValue({ url: 'https://put.example', expiresIn: 600 }),
      createPresignedDownloadUrl: jest
        .fn()
        .mockResolvedValue('https://get.example/avatar'),
      headObject: jest
        .fn()
        .mockResolvedValue({ contentType: 'image/png', contentLength: 1024 }),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfilesService,
        { provide: PrismaService, useValue: { db } },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get(ProfilesService);
  });

  describe('getEnumLookups', () => {
    it('returns every executive title and engagement type with a humanized name', () => {
      const out = service.getEnumLookups();

      expect(out.executive_titles).toEqual(
        expect.arrayContaining([
          { code: ExecutiveTitle.CEO, name: 'Ceo' },
          { code: ExecutiveTitle.CMO, name: 'Cmo' },
        ]),
      );
      expect(out.engagement_types).toEqual(
        expect.arrayContaining([
          { code: EngagementType.FULL_TIME, name: 'Full time' },
          { code: EngagementType.ON_DEMAND, name: 'On demand' },
        ]),
      );
      expect(out.executive_titles).toHaveLength(
        Object.values(ExecutiveTitle).length,
      );
      expect(out.engagement_types).toHaveLength(
        Object.values(EngagementType).length,
      );
    });
  });

  describe('listProfiles', () => {
    it('scopes the query to the user and the active+non-deleted set', async () => {
      db.profile.findMany.mockResolvedValue([]);

      await service.listProfiles('user-1');

      expect(db.profile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user_id: 'user-1',
            is_deleted: false,
            is_active: true,
            organization: { is_deleted: false, status: 'ACTIVE' },
          },
          orderBy: { created_at: 'asc' },
        }),
      );
    });
  });

  describe('updateProfile', () => {
    const baseProfile = {
      id: 'profile-1',
      user: { phone_number: '+201111111111' },
    };

    const baseDetail = {
      id: 'profile-1',
      executive_title: null,
      engagement_type: EngagementType.FULL_TIME,
      user: {
        first_name: 'Sara',
        last_name: 'Ahmed',
        email: 'sara@cradlen.com',
        phone_number: '+201111111111',
      },
      organization: { id: 'org-1', name: 'Cradlen' },
      roles: [],
      branches: [],
      job_functions: [],
      specialty_links: [],
    };

    it('rejects when the profile is not owned by the caller', async () => {
      db.profile.findFirst.mockResolvedValue(null);

      await expect(
        service.updateProfile('attacker', 'profile-1', { first_name: 'Mal' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(db.user.update).not.toHaveBeenCalled();
    });

    it('skips the User update when no scalar fields are present', async () => {
      db.profile.findFirst.mockResolvedValue(baseProfile);
      db.profile.findUniqueOrThrow.mockResolvedValue(baseDetail);

      await service.updateProfile('user-1', 'profile-1', {});

      expect(db.user.update).not.toHaveBeenCalled();
      expect(db.profile.findUniqueOrThrow).toHaveBeenCalled();
    });

    it('writes only the provided User scalars', async () => {
      db.profile.findFirst.mockResolvedValue(baseProfile);
      db.profile.findUniqueOrThrow.mockResolvedValue(baseDetail);

      await service.updateProfile('user-1', 'profile-1', {
        first_name: 'New',
      });

      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { first_name: 'New' },
      });
    });

    it('rejects when the new phone_number collides with another user', async () => {
      db.profile.findFirst.mockResolvedValue(baseProfile);
      db.user.findFirst.mockResolvedValue({ id: 'other-user' });

      await expect(
        service.updateProfile('user-1', 'profile-1', {
          phone_number: '+202000000000',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(db.user.update).not.toHaveBeenCalled();
    });

    it('skips the uniqueness check when the phone_number is unchanged', async () => {
      db.profile.findFirst.mockResolvedValue(baseProfile);
      db.profile.findUniqueOrThrow.mockResolvedValue(baseDetail);

      await service.updateProfile('user-1', 'profile-1', {
        phone_number: '+201111111111',
      });

      expect(db.user.findFirst).not.toHaveBeenCalled();
      expect(db.user.update).toHaveBeenCalled();
    });

    it('writes the new phone_number when no collision is found', async () => {
      db.profile.findFirst.mockResolvedValue(baseProfile);
      db.user.findFirst.mockResolvedValue(null);
      db.profile.findUniqueOrThrow.mockResolvedValue(baseDetail);

      await service.updateProfile('user-1', 'profile-1', {
        phone_number: '+202000000000',
      });

      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { phone_number: '+202000000000' },
      });
    });

    it('persists a trimmed professional_title on the profile', async () => {
      db.profile.findFirst.mockResolvedValue(baseProfile);
      db.profile.findUniqueOrThrow.mockResolvedValue(baseDetail);

      await service.updateProfile('user-1', 'profile-1', {
        professional_title: '  استشاري النساء والتوليد  ',
      });

      expect(db.user.update).not.toHaveBeenCalled();
      expect(db.profile.update).toHaveBeenCalledWith({
        where: { id: 'profile-1' },
        data: { professional_title: 'استشاري النساء والتوليد' },
      });
    });

    it('clears the professional_title when an empty string is provided', async () => {
      db.profile.findFirst.mockResolvedValue(baseProfile);
      db.profile.findUniqueOrThrow.mockResolvedValue(baseDetail);

      await service.updateProfile('user-1', 'profile-1', {
        professional_title: '',
      });

      expect(db.profile.update).toHaveBeenCalledWith({
        where: { id: 'profile-1' },
        data: { professional_title: null },
      });
    });

    it('leaves the professional_title untouched when omitted', async () => {
      db.profile.findFirst.mockResolvedValue(baseProfile);
      db.profile.findUniqueOrThrow.mockResolvedValue(baseDetail);

      await service.updateProfile('user-1', 'profile-1', { first_name: 'New' });

      expect(db.profile.update).not.toHaveBeenCalled();
    });
  });

  describe('profile image', () => {
    const detailWithKey = {
      id: 'profile-1',
      executive_title: null,
      engagement_type: EngagementType.FULL_TIME,
      profile_image_object_key: 'profiles/profile-1/avatar/new.png',
      user: {
        first_name: 'Sara',
        last_name: 'Ahmed',
        email: 'sara@cradlen.com',
        phone_number: '+201111111111',
      },
      organization: { id: 'org-1', name: 'Cradlen' },
      roles: [],
      branches: [],
      job_functions: [],
      specialty_links: [],
    };

    it('createImageUploadUrl rejects a profile not owned by the caller', async () => {
      db.profile.findFirst.mockResolvedValue(null);
      await expect(
        service.createImageUploadUrl('attacker', 'profile-1', {
          content_type: 'image/png',
          size_bytes: 1024,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('createImageUploadUrl returns a presigned PUT scoped to the profile', async () => {
      db.profile.findFirst.mockResolvedValue({
        id: 'profile-1',
        profile_image_object_key: null,
      });

      const res = await service.createImageUploadUrl('user-1', 'profile-1', {
        content_type: 'image/png',
        size_bytes: 1024,
      });

      expect(storage.assertAllowedContentType).toHaveBeenCalledWith(
        'image/png',
      );
      expect(storage.assertWithinSizeLimit).toHaveBeenCalledWith(1024);
      expect(res.key).toMatch(/^profiles\/profile-1\/avatar\/.+\.png$/);
      expect(res.upload_url).toBe('https://put.example');
    });

    it('confirmImage rejects a key outside the profile prefix', async () => {
      db.profile.findFirst.mockResolvedValue({
        id: 'profile-1',
        profile_image_object_key: null,
      });
      await expect(
        service.confirmImage('user-1', 'profile-1', {
          key: 'profiles/other/avatar/x.png',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('confirmImage stores the key, deletes the previous, returns presigned URL', async () => {
      db.profile.findFirst.mockResolvedValue({
        id: 'profile-1',
        profile_image_object_key: 'profiles/profile-1/avatar/old.png',
      });
      db.profile.findUniqueOrThrow.mockResolvedValue(detailWithKey);

      const res = await service.confirmImage('user-1', 'profile-1', {
        key: 'profiles/profile-1/avatar/new.png',
      });

      expect(db.profile.update).toHaveBeenCalledWith({
        where: { id: 'profile-1' },
        data: { profile_image_object_key: 'profiles/profile-1/avatar/new.png' },
      });
      expect(storage.deleteObject).toHaveBeenCalledWith(
        'profiles/profile-1/avatar/old.png',
      );
      expect(res.profile_image_url).toBe('https://get.example/avatar');
    });

    it('removeImage clears the key and deletes the object', async () => {
      db.profile.findFirst.mockResolvedValue({
        id: 'profile-1',
        profile_image_object_key: 'profiles/profile-1/avatar/old.png',
      });
      db.profile.findUniqueOrThrow.mockResolvedValue({
        ...detailWithKey,
        profile_image_object_key: null,
      });

      const res = await service.removeImage('user-1', 'profile-1');

      expect(db.profile.update).toHaveBeenCalledWith({
        where: { id: 'profile-1' },
        data: { profile_image_object_key: null },
      });
      expect(storage.deleteObject).toHaveBeenCalledWith(
        'profiles/profile-1/avatar/old.png',
      );
      expect(res.profile_image_url).toBeNull();
    });
  });
});
