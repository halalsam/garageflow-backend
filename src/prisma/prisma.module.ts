import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global so feature modules use PrismaService without importing PrismaModule.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
