import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializeExpense } from '../common/serializers';
import { apiToExpenseCategory } from '../common/enum-maps';
import { toPaise } from '../common/format';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { monthRange } from '../finance/period.util';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(month?: string) {
    const where: Prisma.ExpenseWhereInput = {};
    if (month) {
      const { start, end } = monthRange(month);
      where.spentAt = { gte: start, lt: end };
    }
    const expenses = await this.prisma.expense.findMany({
      where,
      orderBy: { spentAt: 'desc' },
    });
    return expenses.map(serializeExpense);
  }

  async create(dto: CreateExpenseDto, user: AuthUser) {
    const expense = await this.prisma.expense.create({
      data: {
        title: dto.title,
        category: apiToExpenseCategory[dto.category],
        amountPaise: toPaise(dto.amount),
        spentAt: dto.spentAt ? new Date(dto.spentAt) : new Date(),
        createdById: user.id,
      },
    });
    return serializeExpense(expense);
  }
}
