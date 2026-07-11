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
import { apiToPaymentMethod } from '../common/enum-maps';
import { toPaise } from '../common/format';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { JobEventsService } from '../jobs/job-events.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { UpdateInvoiceLinesDto } from './dto/update-invoice-lines.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: JobEventsService,
  ) {}

  async list(workshopId: string, status?: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { workshopId },
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
  async findOne(id: string, workshopId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { workshopId, OR: [{ id }, { job: { code: id } }] },
      include: invoiceInclude,
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return serializeInvoice(invoice);
  }

  // Replace an invoice's line items (manager/admin) so the office can adjust
  // prices before sharing it. Paid/balance/status are derived from payments, so
  // they re-settle against the new total on the next read.
  async updateLines(id: string, dto: UpdateInvoiceLinesDto, user: AuthUser) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, workshopId: user.workshopId },
      include: { job: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const lines = dto.lines.map((l) => ({
      label: l.label,
      note: l.note,
      amountPaise: toPaise(l.amount),
    }));
    await this.prisma.$transaction([
      this.prisma.invoiceLine.deleteMany({ where: { invoiceId: id } }),
      this.prisma.invoice.update({
        where: { id },
        data: { lines: { create: lines } },
      }),
    ]);

    if (invoice.job) {
      await this.events.emit(invoice.job.id, {
        type: JobEventType.SYSTEM,
        body: `Invoice ${invoice.number} updated`,
      });
    }
    return this.findOne(id, user.workshopId);
  }

  async addPayment(invoiceId: string, dto: RecordPaymentDto, user: AuthUser) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, workshopId: user.workshopId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const payment = await this.prisma.payment.create({
      data: {
        invoiceId,
        amountPaise: toPaise(dto.amount),
        method: apiToPaymentMethod[dto.method],
        takenById: user.id,
      },
    });
    await this.noteIfSettled(invoiceId);
    return serializePayment(payment);
  }

  // Once payments cover the invoice total, note it on the job timeline. Money
  // doesn't move the vehicle: the status stays put until the guided delivery
  // flow (walk-around photos + hand-off note) marks the job DELIVERED.
  private async noteIfSettled(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lines: true, payments: true, job: true },
    });
    if (!invoice?.job) return;
    const { total } = computeTotals(invoice.lines, invoice.gstRate);
    if (invoicePaid(invoice) < total) return;

    await this.events.emit(invoice.job.id, {
      type: JobEventType.SYSTEM,
      body: `Invoice ${invoice.number} paid in full`,
      payload: { tone: 'green', icon: 'check-circle' },
    });
  }
}
