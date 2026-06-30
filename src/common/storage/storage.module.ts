import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { UploadsController } from './uploads.controller';

// Global so any module can inject StorageService without importing this module.
@Global()
@Module({
  controllers: [UploadsController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
