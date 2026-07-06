import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { FinanceService } from './finance.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// All finance/reports are manager+ (RBAC §6) and fully derived.
@ApiTags('finance')
@ApiBearerAuth('access-token')
@Controller('finance')
@Roles(UserRole.MANAGER, UserRole.ADMIN)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('summary')
  summary(
    @CurrentUser('workshopId') workshopId: string,
    @Query('day') day?: string,
    @Query('month') month?: string,
  ) {
    return this.finance.summary(workshopId, day, month);
  }

  @Get('receivables')
  receivables(@CurrentUser('workshopId') workshopId: string) {
    return this.finance.receivables(workshopId);
  }

  @Get('collections')
  collections(@CurrentUser('workshopId') workshopId: string, @Query('day') day?: string) {
    return this.finance.collections(workshopId, day);
  }

  @Get('gst')
  gst(@CurrentUser('workshopId') workshopId: string, @Query('month') month?: string) {
    return this.finance.gst(workshopId, month);
  }

  @Get('profit')
  profit(@CurrentUser('workshopId') workshopId: string, @Query('month') month?: string) {
    return this.finance.profit(workshopId, month);
  }

  @Get('ledgers')
  ledgers(@CurrentUser('workshopId') workshopId: string) {
    return this.finance.ledgers(workshopId);
  }

  @Get('ledgers/:customerId')
  ledger(@Param('customerId') customerId: string, @CurrentUser('workshopId') workshopId: string) {
    return this.finance.ledger(customerId, workshopId);
  }
}
