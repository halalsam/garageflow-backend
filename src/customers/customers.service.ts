import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { customerInclude, paginate, serializeCustomer } from '../common/serializers';
import { initialsOf } from '../common/format';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const AVATAR_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'];

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  // Paginated<Customer> — the one paginated list (ARCHITECTURE §4).
  async search(query?: string, page = 1, pageSize = 20) {
    const where: Prisma.CustomerWhereInput = query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: customerInclude,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return paginate(rows.map(serializeCustomer), total, page, pageSize);
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: customerInclude,
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return serializeCustomer(customer);
  }

  async create(dto: CreateCustomerDto) {
    const count = await this.prisma.customer.count();
    const customer = await this.prisma.customer.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        initials: initialsOf(dto.name),
        color: AVATAR_KEYS[count % AVATAR_KEYS.length],
      },
      include: customerInclude,
    });
    return serializeCustomer(customer);
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findOne(id);
    const customer = await this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name, initials: initialsOf(dto.name) } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      },
      include: customerInclude,
    });
    return serializeCustomer(customer);
  }
}
