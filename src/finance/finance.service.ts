import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeTotals,
  invoiceInclude,
  serializeInvoice,
} from '../common/serializers';
import { paymentMethodToApi } from '../common/enum-maps';
import { formatDate, isoDate, shortName, toRupees } from '../common/format';
import { dayRange, monthRange, weekRange } from './period.util';

// Everything here is DERIVED from invoices + payments + expenses — never stored.
@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  private invoicesWith(workshopId: string) {
    return this.prisma.invoice.findMany({ where: { workshopId }, include: invoiceInclude });
  }

  // ── Summary (outstanding / collected today / revenue this week) ───────────
  async summary(workshopId: string, day?: string, _month?: string) {
    const now = new Date();
    const invoices = await this.invoicesWith(workshopId);

    let outstanding = 0;
    for (const inv of invoices) {
      const { total } = computeTotals(inv.lines, inv.gstRate);
      const paid = toRupees(inv.payments.reduce((s, p) => s + p.amountPaise, 0));
      const balance = total - paid;
      if (balance > 0) outstanding += balance;
    }

    const { start: dStart, end: dEnd } = dayRange(day, now);
    const payments = await this.prisma.payment.findMany({
      where: { at: { gte: dStart, lt: dEnd }, invoice: { workshopId } },
    });
    const collectedToday = toRupees(payments.reduce((s, p) => s + p.amountPaise, 0));

    const anchor = day ? new Date(`${day}T00:00:00.000Z`) : now;
    const { start: wStart, end: wEnd } = weekRange(anchor);
    const revenueThisWeek = invoices
      .filter((i) => i.issuedAt >= wStart && i.issuedAt < wEnd)
      .reduce((s, i) => s + computeTotals(i.lines, i.gstRate).subtotal, 0);

    return { outstanding, collectedToday, revenueThisWeek };
  }

  // ── Receivables (balance > 0, biggest first) ──────────────────────────────
  async receivables(workshopId: string) {
    const invoices = await this.invoicesWith(workshopId);
    return invoices
      .map(serializeInvoice)
      .filter((i) => i.balance > 0)
      .sort((a, b) => b.balance - a.balance);
  }

  // ── Day book (collections by method) ──────────────────────────────────────
  async collections(workshopId: string, day?: string) {
    const { start, end } = dayRange(day);
    const payments = await this.prisma.payment.findMany({
      where: { at: { gte: start, lt: end }, invoice: { workshopId } },
    });
    const methods = (['CASH', 'UPI', 'CARD'] as PaymentMethod[]).map((m) => {
      const ps = payments.filter((p) => p.method === m);
      return {
        method: paymentMethodToApi[m],
        amount: toRupees(ps.reduce((s, p) => s + p.amountPaise, 0)),
        count: ps.length,
      };
    });
    return {
      methods,
      total: toRupees(payments.reduce((s, p) => s + p.amountPaise, 0)),
      count: payments.length,
    };
  }

  // ── GST output-tax (CGST + SGST split) ────────────────────────────────────
  async gst(workshopId: string, month?: string) {
    const { start, end } = monthRange(month);
    const invoices = await this.prisma.invoice.findMany({
      where: { workshopId, issuedAt: { gte: start, lt: end } },
      include: invoiceInclude,
    });
    let taxable = 0;
    let gst = 0;
    for (const inv of invoices) {
      const t = computeTotals(inv.lines, inv.gstRate);
      taxable += t.subtotal;
      gst += t.gst;
    }
    const cgst = Math.round(gst / 2);
    return { taxable, gst, cgst, sgst: gst - cgst, count: invoices.length };
  }

  // ── Profit (ex-GST revenue − expenses) ────────────────────────────────────
  async profit(workshopId: string, month?: string) {
    const { start, end } = monthRange(month);
    const [invoices, expenses] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { workshopId, issuedAt: { gte: start, lt: end } },
        include: invoiceInclude,
      }),
      this.prisma.expense.findMany({ where: { spentAt: { gte: start, lt: end } } }),
    ]);
    const revenue = invoices.reduce((s, i) => s + computeTotals(i.lines, i.gstRate).subtotal, 0);
    const expensesTotal = toRupees(expenses.reduce((s, e) => s + e.amountPaise, 0));
    return { revenue, expenses: expensesTotal, profit: revenue - expensesTotal };
  }

  // ── Party ledgers ─────────────────────────────────────────────────────────
  async ledgers(workshopId: string) {
    const customers = await this.prisma.customer.findMany({
      where: { workshopId },
      include: { invoices: { include: invoiceInclude } },
    });
    return customers
      .map((c) => {
        let closing = 0;
        for (const inv of c.invoices) {
          const { total } = computeTotals(inv.lines, inv.gstRate);
          const paid = toRupees(inv.payments.reduce((s, p) => s + p.amountPaise, 0));
          closing += total - paid;
        }
        return { id: c.id, name: shortName(c.name), closing, invoices: c.invoices.length };
      })
      .filter((p) => p.invoices > 0)
      .sort((a, b) => b.closing - a.closing);
  }

  async ledger(customerId: string, workshopId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, workshopId },
      include: { invoices: { include: invoiceInclude } },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    type Row = {
      at: string;
      date: string;
      particulars: string;
      ref: string;
      debit: number;
      credit: number;
    };
    const rows: Row[] = [];
    let billed = 0;
    for (const inv of customer.invoices) {
      const { total } = computeTotals(inv.lines, inv.gstRate);
      billed += total;
      const car = inv.vehicle ?? inv.job?.vehicle ?? null;
      rows.push({
        at: new Date(`${isoDate(inv.issuedAt)}T00:00:00.000Z`).toISOString(),
        date: formatDate(inv.issuedAt),
        particulars: `Invoice · ${car ? `${car.make} ${car.model}` : inv.number}`,
        ref: inv.number,
        debit: total,
        credit: 0,
      });
      for (const p of inv.payments) {
        rows.push({
          at: p.at.toISOString(),
          date: formatDate(p.at),
          particulars: `Payment · ${paymentMethodToApi[p.method]}`,
          ref: inv.number,
          debit: 0,
          credit: toRupees(p.amountPaise),
        });
      }
    }
    rows.sort((a, b) => (a.at < b.at ? -1 : 1));
    let balance = 0;
    const entries = rows.map((r) => {
      balance += r.debit - r.credit;
      return { ...r, balance };
    });
    return { customer: shortName(customer.name), billed, closing: balance, entries };
  }
}
