import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '@config/storage.config.js';

export interface PresignedUpload {
  url: string;
  expiresIn: number;
}

export interface ObjectHead {
  contentType?: string;
  contentLength?: number;
}

/**
 * Object-storage adapter for Cloudflare R2 (S3-compatible). The vendor SDK is
 * confined to this folder per the layer boundary. The bucket is private — callers
 * store the object KEY and mint short-lived presigned URLs on demand for upload
 * (PUT) and download (GET); the API never streams the binary itself.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly putTtlSeconds: number;
  private readonly getTtlSeconds: number;
  private readonly maxBytes: number;
  private readonly allowedContentTypes: ReadonlySet<string>;
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(storageConfig.KEY)
    config: ConfigType<typeof storageConfig>,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.r2.endpoint,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    });
    this.bucket = config.r2.bucket;
    this.putTtlSeconds = config.presign.putTtlSeconds;
    this.getTtlSeconds = config.presign.getTtlSeconds;
    this.maxBytes = config.uploads.maxBytes;
    this.allowedContentTypes = new Set(config.uploads.allowedContentTypes);
  }

  /** Throws 400 when the content type is not in the configured allowlist. */
  assertAllowedContentType(contentType: string): void {
    if (!this.allowedContentTypes.has(contentType)) {
      throw new BadRequestException({
        message: 'Unsupported file type',
        details: { allowed: [...this.allowedContentTypes] },
      });
    }
  }

  /** Throws 400 when the byte size is missing, non-positive, or over the limit. */
  assertWithinSizeLimit(sizeBytes: number): void {
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      throw new BadRequestException('Invalid file size');
    }
    if (sizeBytes > this.maxBytes) {
      throw new BadRequestException({
        message: 'File is too large',
        details: { maxBytes: this.maxBytes },
      });
    }
  }

  /** Maps an allowed content type to a file extension for the object key. */
  extensionFor(contentType: string): string {
    switch (contentType) {
      case 'application/pdf':
        return 'pdf';
      case 'image/png':
        return 'png';
      case 'image/jpeg':
        return 'jpg';
      case 'image/webp':
        return 'webp';
      default:
        return 'bin';
    }
  }

  async createPresignedUploadUrl(params: {
    key: string;
    contentType: string;
  }): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.contentType,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: this.putTtlSeconds,
    });
    return { url, expiresIn: this.putTtlSeconds };
  }

  async createPresignedDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, {
      expiresIn: this.getTtlSeconds,
    });
  }

  /** Returns object metadata, or null when the object does not exist. */
  async headObject(key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        contentType: res.ContentType,
        contentLength: res.ContentLength,
      };
    } catch (error) {
      if (this.isNotFound(error)) return null;
      this.logger.error({ message: 'R2 headObject failed', key });
      throw new InternalServerErrorException('Storage error');
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  private isNotFound(error: unknown): boolean {
    const shape = (error ?? {}) as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      shape.name === 'NotFound' ||
      shape.name === 'NoSuchKey' ||
      shape.$metadata?.httpStatusCode === 404
    );
  }
}
