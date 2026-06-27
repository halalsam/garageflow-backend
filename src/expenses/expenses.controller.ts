import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ExpensesService } from './expenses.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CreateExpenseDto } from './dto/create-expense.dto';

// Expenses are manager+ (RBAC §6).
@ApiTags('expenses')
@ApiBearerAuth('access-token')
@Controller('expenses')
@Roles(UserRole.MANAGER, UserRole.ADMIN)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(@Query('month') month?: string) {
    return this.expenses.list(month);
  }

  @Post()
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user: AuthUser) {
    return this.expenses.create(dto, user);
  }
}
