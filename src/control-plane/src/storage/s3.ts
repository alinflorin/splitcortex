import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Config } from '../config';
import type { ModelStorage } from './types';

export interface S3Settings {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function s3SettingsFromConfig(config: Config): S3Settings | null {
  if (!config.S3_ENDPOINT || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) return null;
  return {
    endpoint: config.S3_ENDPOINT,
    bucket: config.S3_BUCKET,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  };
}

export function createS3Storage(s: S3Settings): ModelStorage {
  const client = new S3Client({
    endpoint: s.endpoint,
    region: s.region,
    forcePathStyle: true, // Garage addresses buckets by path unless a root domain is configured
    requestChecksumCalculation: 'WHEN_REQUIRED', // streamed parts: no extra checksum trailers
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
  });
  const Bucket = s.bucket;

  return {
    async createMultipart(Key) {
      const res = await client.send(new CreateMultipartUploadCommand({ Bucket, Key }));
      return { uploadId: res.UploadId! };
    },
    async uploadPart(Key, UploadId, PartNumber, Body, ContentLength) {
      const res = await client.send(
        new UploadPartCommand({ Bucket, Key, UploadId, PartNumber, Body, ContentLength }),
      );
      return { etag: res.ETag! };
    },
    async completeMultipart(Key, UploadId, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key,
          UploadId,
          MultipartUpload: {
            Parts: parts
              .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag }))
              .sort((a, b) => a.PartNumber - b.PartNumber),
          },
        }),
      );
    },
    async abortMultipart(Key, UploadId) {
      await client.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }));
    },
    async head(Key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket, Key }));
        return { size: res.ContentLength ?? 0 };
      } catch (err) {
        if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
          return null;
        throw err;
      }
    },
    async put(Key, Body, opts) {
      const upload = new Upload({
        client,
        params: { Bucket, Key, Body },
        partSize: 64 * 1024 ** 2,
        queueSize: 3,
        leavePartsOnError: false,
      });
      opts?.signal?.addEventListener('abort', () => void upload.abort(), { once: true });
      await upload.done();
      const head = await this.head(Key);
      return { size: head?.size ?? 0 };
    },
    async delete(Key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key }));
    },
  };
}
