import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { FinanceService } from './finance.service';
import { Roles } from '../common/decorators/roles.decorator';

// All finance/reports are manager+ (RBAC §6) and fully derived.
@ApiTags('finance')
@ApiBearerAuth('access-token')
@Controller('finance')
@Roles(UserRole.MANAGER, UserRole.ADMIN)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('summary')
  summary(@Query('day') day?: string, @Query('month') month?: string) {
    return this.finance.summary(day, month);
  }

  @Get('receivables')
  receivables() {
    return this.finance.receivables();
  }

  @Get('collections')
  collections(@Query('day') day?: string) {
    return this.finance.collections(day);
  }

  @Get('gst')
  gst(@Query('month') month?: string) {
    return this.finance.gst(month);
  }

  @Get('profit')
  profit(@Query('month') month?: string) {
    return this.finance.profit(month);
  }

  @Get('ledgers')
  ledgers() {
    return this.finance.ledgers();
  }

  @Get('ledgers/:customerId')
  ledger(@Param('customerId') customerId: string) {
    return this.finance.ledger(customerId);
  }
}
