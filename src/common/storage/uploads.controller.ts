import { BadRequestException, Controller, Param, Put, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../decorators/public.decorator';
import { StorageService } from './storage.service';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB cap for a single upload

// The local presigned-upload fallback (used when no S3 creds are configured).
// The client PUTs the raw file bytes to the one-time token URL handed out by
// StorageService.createPresignedUpload. @Public(): the token is the credential.
@ApiExcludeController()
@Controller('uploads/presigned')
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Put(':token')
  async upload(@Param('token') token: string, @Req() req: Request) {
    const body = await readBody(req);
    const url = await this.storage.consumePresigned(token, body);
    return { url };
  }
}

// Read the raw request stream into a Buffer. Binary content-types (image/*) are
// untouched by the global json/urlencoded parsers, so the stream is intact here.
function readBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new BadRequestException('Upload exceeds 25 MB limit'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
