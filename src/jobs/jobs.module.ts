import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { EstimatesModule } from '../estimates/estimates.module';
import { JobEventsModule } from './job-events.module';

@Module({
  imports: [EstimatesModule, JobEventsModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
