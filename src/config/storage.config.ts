import { registerAs } from '@nestjs/config';
import { parseList, parsePositiveInt, requireEnv } from './env.utils.js';

const DEFAULT_ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
];

export interface StorageConfig {
  r2: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    endpoint: string;
  };
  presign: {
    putTtlSeconds: number;
    getTtlSeconds: number;
  };
  uploads: {
    maxBytes: number;
    allowedContentTypes: string[];
  };
}

export default registerAs('storage', (): StorageConfig => {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  return {
    r2: {
      accountId,
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
      bucket: requireEnv('R2_BUCKET'),
      endpoint:
        process.env.R2_ENDPOINT ??
        `https://${accountId}.r2.cloudflarestorage.com`,
    },
    presign: {
      putTtlSeconds: parsePositiveInt('R2_PRESIGN_PUT_TTL_SECONDS', '300'),
      // Short-lived download links: a presigned GET only needs to live long
      // enough for the client to START the fetch, so a tight default narrows the
      // window in which a leaked result-file URL is replayable.
      getTtlSeconds: parsePositiveInt('R2_PRESIGN_GET_TTL_SECONDS', '120'),
    },
    uploads: {
      maxBytes: parsePositiveInt('R2_MAX_UPLOAD_BYTES', '15000000'),
      allowedContentTypes: parseList(
        process.env.R2_ALLOWED_CONTENT_TYPES,
        DEFAULT_ALLOWED_CONTENT_TYPES,
      ),
    },
  };
});
