import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { EstimatesService } from './estimates.service';

@Module({
  controllers: [ApprovalsController],
  providers: [EstimatesService],
  exports: [EstimatesService],
})
export class EstimatesModule {}
