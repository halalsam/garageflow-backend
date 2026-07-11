import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { UpdateInvoiceLinesDto } from './dto/update-invoice-lines.dto';

// Invoices + payments are manager+ (RBAC §6).
@ApiTags('invoices')
@ApiBearerAuth('access-token')
@Controller('invoices')
@Roles(UserRole.MANAGER, UserRole.ADMIN)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(@CurrentUser('workshopId') workshopId: string, @Query('status') status?: string) {
    return this.invoices.list(workshopId, status);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser('workshopId') workshopId: string) {
    return this.invoices.findOne(id, workshopId);
  }

  @Patch(':id/lines')
  updateLines(
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceLinesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invoices.updateLines(id, dto, user);
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
