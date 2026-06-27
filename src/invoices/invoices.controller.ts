import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { RecordPaymentDto } from './dto/record-payment.dto';

// Invoices + payments are manager+ (RBAC §6).
@ApiTags('invoices')
@ApiBearerAuth('access-token')
@Controller('invoices')
@Roles(UserRole.MANAGER, UserRole.ADMIN)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.invoices.list(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.invoices.findOne(id);
  }

  @Post(':id/payments')
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invoices.addPayment(id, dto, user);
  }
}
