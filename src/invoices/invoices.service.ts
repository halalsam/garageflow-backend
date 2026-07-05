import { Injectable, NotFoundException } from '@nestjs/common';
import { JobEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeTotals,
  invoiceInclude,
  invoicePaid,
  serializeInvoice,
  serializePayment,
} from '../common/serializers';
import { apiToPaymentMethod, jobStatusToApi } from '../common/enum-maps';
import { toPaise } from '../common/format';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { JobEventsService } from '../jobs/job-events.service';
import { RecordPaymentDto } from './dto/record-payment.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: JobEventsService,
  ) {}

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

  // Looks up by invoice UUID, falling back to the job code ("j12") so links
  // built from a job screen resolve that job's invoice directly.
  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { OR: [{ id }, { job: { code: id } }] },
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
    await this.closeJobIfSettled(invoiceId, user);
    return serializePayment(payment);
  }

  // Once payments cover the invoice total, the linked job is finished: it moves
  // to DELIVERED no matter where the payment was recorded from.
  private async closeJobIfSettled(invoiceId: string, user: AuthUser) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lines: true, payments: true, job: true },
    });
    if (!invoice?.job || invoice.job.status === 'DELIVERED') return;
    const { total } = computeTotals(invoice.lines, invoice.gstRate);
    if (invoicePaid(invoice) < total) return;

    const from = invoice.job.status;
    await this.prisma.job.update({
      where: { id: invoice.job.id },
      data: {
        status: 'DELIVERED',
        progress: 100,
        deliveredAt: new Date(),
        deliveredById: user.id,
      },
    });
    await this.events.emit(invoice.job.id, {
      type: JobEventType.STATUS_CHANGE,
      authorId: user.id,
      payload: { from: jobStatusToApi[from].status, to: jobStatusToApi.DELIVERED.status },
    });
    await this.events.emit(invoice.job.id, {
      type: JobEventType.SYSTEM,
      body: `Invoice ${invoice.number} paid in full — job closed`,
    });
  }
}
