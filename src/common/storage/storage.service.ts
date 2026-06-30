import { GoneException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type PresignedUpload = {
  uploadUrl: string; // where the client PUTs the bytes
  fileUrl: string; // public URL the file will be served from afterwards
  method: 'PUT';
  headers: Record<string, string>;
};

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/gif': '.gif',
};

// Local-disk storage that returns a public URL, plus a presigned-upload path so
// large files (photos) are PUT straight to storage and never cross the socket.
// S3/R2-swappable: when S3_* env is set, presign against the bucket; otherwise a
// local fallback hands out a one-time PUT endpoint so it runs with no creds.
@Injectable()
export class StorageService {
  private readonly uploadDir = join(process.cwd(), 'uploads');
  private readonly publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000';

  // token → target for the local presigned PUT fallback (one-time, single-node).
  private readonly pending = new Map<string, { rel: string; contentType: string }>();

  /** Persist a multer file and return its absolute public URL. */
  async save(file: { originalname: string; buffer: Buffer }, subdir = ''): Promise<string> {
    const dir = join(this.uploadDir, subdir);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}${extname(file.originalname) || ''}`;
    await writeFile(join(dir, name), file.buffer);
    const rel = [subdir, name].filter(Boolean).join('/');
    return `${this.publicUrl}/uploads/${rel}`;
  }

  private get s3Bucket(): string | undefined {
    return process.env.S3_BUCKET || undefined;
  }

  /** A presigned PUT the client uploads to, plus the resulting public file URL. */
  async createPresignedUpload(contentType: string, subdir = ''): Promise<PresignedUpload> {
    const name = `${randomUUID()}${EXT_BY_TYPE[contentType] ?? ''}`;
    const rel = [subdir, name].filter(Boolean).join('/');

    if (this.s3Bucket) {
      const client = new S3Client({
        region: process.env.S3_REGION ?? 'auto',
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: !!process.env.S3_ENDPOINT,
        credentials:
          process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.S3_ACCESS_KEY_ID,
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
              }
            : undefined,
      });
      const uploadUrl = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: this.s3Bucket, Key: rel, ContentType: contentType }),
        { expiresIn: 600 },
      );
      const base =
        process.env.S3_PUBLIC_URL ??
        `${process.env.S3_ENDPOINT ?? ''}/${this.s3Bucket}`.replace(/\/+$/, '');
      return {
        uploadUrl,
        fileUrl: `${base}/${rel}`,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
      };
    }

    // Local fallback: one-time token-scoped PUT endpoint (under the /api prefix);
    // the resulting file is then served statically at /uploads.
    const token = randomUUID();
    this.pending.set(token, { rel, contentType });
    return {
      uploadUrl: `${this.publicUrl}/api/uploads/presigned/${token}`,
      fileUrl: `${this.publicUrl}/uploads/${rel}`,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    };
  }

  /** Consume a local presigned token: write the body to disk, return its URL. */
  async consumePresigned(token: string, body: Buffer): Promise<string> {
    const entry = this.pending.get(token);
    if (!entry) throw new GoneException('Upload token is invalid or already used');
    this.pending.delete(token);
    const full = join(this.uploadDir, entry.rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
    return `${this.publicUrl}/uploads/${entry.rel}`;
  }
}
