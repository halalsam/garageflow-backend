import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JobEventsGateway } from './job-events.gateway';
import { JobEventsService } from './job-events.service';

// Houses the realtime gateway + the write/read path for job-card events.
// Depends only on the global Prisma/Redis modules and JwtModule, so both
// JobsModule and EstimatesModule can import it without a circular dependency.
@Module({
  imports: [JwtModule.register({})],
  providers: [JobEventsGateway, JobEventsService],
  exports: [JobEventsService, JobEventsGateway],
})
export class JobEventsModule {}
