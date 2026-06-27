import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { invoiceInclude, serializeInvoice, serializePayment } from '../common/serializers';
import { apiToPaymentMethod } from '../common/enum-maps';
import { toPaise } from '../common/format';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RecordPaymentDto } from './dto/record-payment.dto';

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(status?: string) {
    const invoices = await this.prisma.invoice.findMany({
      include: invoiceInclude,
      orderBy: { issuedAt: 'desc' },
    });
    const serialized = invoices.map(serializeInvoice);
    if (status) {
      const want = status.toUpperCase(); // PAID | PARTIAL | UNPAID
      return serialized.filter((i) => i.status === want);
    }
    return serialized;
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return serializeInvoice(invoice);
  }

  async addPayment(invoiceId: string, dto: RecordPaymentDto, user: AuthUser) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const payment = await this.prisma.payment.create({
      data: {
        invoiceId,
        amountPaise: toPaise(dto.amount),
        method: apiToPaymentMethod[dto.method],
        takenById: user.id,
      },
    });
    return serializePayment(payment);
  }
}
