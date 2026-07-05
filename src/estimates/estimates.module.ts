import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { EstimatesService } from './estimates.service';
import { JobEventsModule } from '../jobs/job-events.module';
import { WorkshopsModule } from '../workshops/workshops.module';

@Module({
  imports: [JobEventsModule, WorkshopsModule],
  controllers: [ApprovalsController],
  providers: [EstimatesService],
  exports: [EstimatesService],
})
export class EstimatesModule {}
