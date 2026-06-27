import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

// Local-disk storage that returns a public URL. S3-swappable: keep callers
// depending only on save() → url. Files land in /uploads, served statically.
@Injectable()
export class StorageService {
  private readonly uploadDir = join(process.cwd(), 'uploads');
  private readonly publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000';

  /** Persist a multer file and return its absolute public URL. */
  async save(file: { originalname: string; buffer: Buffer }, subdir = ''): Promise<string> {
    const dir = join(this.uploadDir, subdir);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}${extname(file.originalname) || ''}`;
    await writeFile(join(dir, name), file.buffer);
    const rel = [subdir, name].filter(Boolean).join('/');
    return `${this.publicUrl}/uploads/${rel}`;
  }
}
