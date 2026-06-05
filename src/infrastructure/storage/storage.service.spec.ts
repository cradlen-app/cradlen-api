import { BadRequestException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '@config/storage.config.js';
import { StorageService } from './storage.service.js';

function makeService(): StorageService {
  const config = {
    r2: {
      accountId: 'acct',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'bucket',
      endpoint: 'https://acct.r2.cloudflarestorage.com',
    },
    presign: { putTtlSeconds: 300, getTtlSeconds: 300 },
    uploads: {
      maxBytes: 1000,
      allowedContentTypes: ['application/pdf', 'image/jpeg'],
    },
  } as ConfigType<typeof storageConfig>;
  return new StorageService(config);
}

describe('StorageService guards', () => {
  let service: StorageService;

  beforeEach(() => {
    service = makeService();
  });

  it('accepts an allowed content type and rejects others', () => {
    expect(() =>
      service.assertAllowedContentType('application/pdf'),
    ).not.toThrow();
    expect(() => service.assertAllowedContentType('text/html')).toThrow(
      BadRequestException,
    );
  });

  it('rejects non-positive and oversized files', () => {
    expect(() => service.assertWithinSizeLimit(0)).toThrow(BadRequestException);
    expect(() => service.assertWithinSizeLimit(1001)).toThrow(
      BadRequestException,
    );
    expect(() => service.assertWithinSizeLimit(1000)).not.toThrow();
  });

  it('maps content types to file extensions', () => {
    expect(service.extensionFor('application/pdf')).toBe('pdf');
    expect(service.extensionFor('image/jpeg')).toBe('jpg');
    expect(service.extensionFor('image/png')).toBe('png');
    expect(service.extensionFor('image/webp')).toBe('webp');
    expect(service.extensionFor('application/unknown')).toBe('bin');
  });
});
