// The ONLY response boundary: Prisma row → the JSON shapes the mobile app
// (../garageflow/data/mock.ts) consumes. Nothing else returns raw rows.
import { Prisma } from '@prisma/client';
import {
  catalogueKindToApi,
  expenseCategoryToApi,
  jobStatusToApi,
  paymentMethodToApi,
  priorityToApi,
  roleToApi,
  timelineKindToApi,
  vehicleTypeToApi,
} from './enum-maps';
import {
  formatDate,
  formatDuration,
  formatTime,
  isoDate,
  relativeTime,
  shortName,
  toRupees,
} from './format';

// ── Reusable include shapes (keep query results in sync with serializers) ─────
export const customerInclude = Prisma.validator<Prisma.CustomerInclude>()({
  vehicles: true,
});

export const jobInclude = Prisma.validator<Prisma.JobInclude>()({
  vehicle: true,
  customer: true,
  tech: true,
  estimate: { include: { lines: true } },
  invoice: { include: { lines: true, payments: true } },
});

export const jobWithTimelineInclude = Prisma.validator<Prisma.JobInclude>()({
  ...jobInclude,
  timeline: { include: { author: true }, orderBy: { at: 'asc' } },
  reads: { include: { user: true } },
  completionPhotos: true,
});

// The four required walk-around sides, in display order.
export const COMPLETION_SIDES = ['FRONT', 'BACK', 'LEFT', 'RIGHT'] as const;
export type CompletionSide = (typeof COMPLETION_SIDES)[number];

export const estimateInclude = Prisma.validator<Prisma.EstimateInclude>()({
  job: { include: { vehicle: true, customer: true } },
  submittedBy: true,
  decidedBy: true,
  lines: true,
});

export const invoiceInclude = Prisma.validator<Prisma.InvoiceInclude>()({
  customer: true,
  vehicle: true,
  job: { include: { vehicle: true } },
  lines: true,
  payments: true,
});

// ── Person ───────────────────────────────────────────────────────────────────
type PersonLike = { name: string; initials: string; color: string };
export const serializePerson = (p: PersonLike) => ({
  name: p.name,
  initials: p.initials,
  color: p.color,
});

// ── User / auth ──────────────────────────────────────────────────────────────
type UserRow = Prisma.UserGetPayload<{}>;
export const serializeUser = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone ?? undefined,
  initials: u.initials,
  color: u.color,
  avatarUrl: u.avatarUrl ?? undefined,
  active: u.active,
  ...roleToApi[u.role],
});

// TeamMember = Person & { phone?, role, roleLabel, roleIcon, active?/inactive? }
export const serializeTeamMember = (u: UserRow) => ({
  ...serializePerson(u),
  id: u.id,
  phone: u.phone ?? undefined,
  ...roleToApi[u.role],
  active: u.active ? true : undefined,
  inactive: u.active ? undefined : true,
});

// ── Customer / Vehicle ───────────────────────────────────────────────────────
type VehicleRow = Prisma.VehicleGetPayload<{}>;
export const serializeVehicle = (v: VehicleRow) => ({
  id: v.id,
  plate: v.plate,
  make: v.make,
  model: v.model,
  year: v.year,
  type: vehicleTypeToApi[v.type],
});

type CustomerRow = Prisma.CustomerGetPayload<{ include: typeof customerInclude }>;
export const serializeCustomer = (c: CustomerRow) => ({
  id: c.id,
  name: c.name,
  initials: c.initials,
  color: c.color,
  phone: c.phone ?? undefined,
  vehicles: (c.vehicles ?? []).map(serializeVehicle),
});

// ── Catalogue ────────────────────────────────────────────────────────────────
type CatalogueRow = Prisma.CatalogueItemGetPayload<{}>;
export const serializeCatalogueItem = (i: CatalogueRow) => ({
  id: i.id,
  name: i.name,
  sku: i.sku,
  stock: i.stock ?? undefined,
  price: toRupees(i.pricePaise),
  kind: catalogueKindToApi[i.kind],
});

// ── GST / totals (derived, never stored) ─────────────────────────────────────
export type Totals = { subtotal: number; gst: number; total: number };
export const computeTotals = (
  lines: { amountPaise: number }[],
  gstRate: number,
): Totals => {
  const subtotal = toRupees(lines.reduce((s, l) => s + l.amountPaise, 0));
  const gst = Math.round((subtotal * gstRate) / 100);
  return { subtotal, gst, total: subtotal + gst };
};

const serializeLine = (l: { label: string; note: string; amountPaise: number }) => ({
  label: l.label,
  note: l.note,
  amount: toRupees(l.amountPaise),
});

// ── Job ──────────────────────────────────────────────────────────────────────
type JobRow = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

const jobAmount = (j: JobRow): number | undefined => {
  if (j.invoice) {
    return computeTotals(j.invoice.lines, j.invoice.gstRate).total;
  }
  if (j.status === 'REVIEW' && j.estimate) {
    return computeTotals(j.estimate.lines, j.estimate.gstRate).total;
  }
  return undefined;
};

export const serializeJob = (j: JobRow) => ({
  id: j.code,
  plate: j.vehicle.plate,
  make: j.vehicle.make,
  model: j.vehicle.model,
  year: j.vehicle.year,
  type: vehicleTypeToApi[j.vehicle.type],
  bay: j.bay ?? undefined,
  customer: serializePerson(j.customer),
  tech: j.tech ? serializePerson(j.tech) : undefined,
  ...jobStatusToApi[j.status],
  priority: priorityToApi[j.priority],
  complaint: j.complaint ?? undefined,
  progress: j.progress ?? undefined,
  amount: jobAmount(j),
});

// ── Timeline ─────────────────────────────────────────────────────────────────
type TimelineRow = Prisma.JobTimelineEntryGetPayload<{ include: { author: true } }>;
export const serializeTimelineItem = (t: TimelineRow) => {
  const time = formatTime(t.at);
  // ISO timestamp lets clients compare against per-user read markers.
  const atISO = t.at.toISOString();
  // Include the author's stable id so clients can reliably tell which entries
  // belong to the current user (initials/name alone can collide).
  const by = t.author ? { id: t.author.id, ...serializePerson(t.author) } : undefined;
  switch (t.kind) {
    case 'SYSTEM':
      return {
        kind: 'system' as const,
        text: t.text ?? '',
        tone: (t.systemTone as 'purple' | 'green') ?? 'purple',
        icon: t.systemIcon ?? undefined,
      };
    case 'TEXT':
      return { kind: 'text' as const, by, text: t.text ?? '', time, atISO };
    case 'PHOTO':
      return { kind: 'photo' as const, by, tag: t.tag ?? undefined, time, atISO, uri: t.imageUrl ?? undefined };
    case 'VOICE':
      return {
        kind: 'voice' as const,
        by,
        dur: formatDuration(t.durationMs ?? 0),
        time,
        atISO,
        uri: t.audioUrl ?? undefined,
      };
    case 'PART':
      return {
        kind: 'part' as const,
        by,
        name: t.partName ?? '',
        qty: t.qty ?? 0,
        price: toRupees(t.pricePaise ?? 0),
        time,
        atISO,
      };
    default:
      return { kind: timelineKindToApi[t.kind], time, atISO };
  }
};

// Per-user read markers for a job: who has read the chat and up to when.
type ReadRow = Prisma.JobReadGetPayload<{ include: { user: true } }>;
export const serializeRead = (r: ReadRow) => ({
  by: { id: r.user.id, ...serializePerson(r.user) },
  atISO: r.at.toISOString(),
});

// Mandatory completion photo. Side is lower-cased for the client.
type CompletionPhotoRow = Prisma.CompletionPhotoGetPayload<{}>;
export const serializeCompletionPhoto = (p: CompletionPhotoRow) => ({
  side: p.side.toLowerCase() as Lowercase<CompletionSide>,
  uri: p.url,
});

// ── Approval (a PENDING estimate) ────────────────────────────────────────────
type EstimateRow = Prisma.EstimateGetPayload<{ include: typeof estimateInclude }>;
export const serializeApproval = (e: EstimateRow) => {
  const totals = computeTotals(e.lines, e.gstRate);
  return {
    id: e.job.code,
    plate: e.job.vehicle.plate,
    car: `${e.job.vehicle.make} ${e.job.vehicle.model}`,
    customer: shortName(e.job.customer.name),
    submittedBy: serializePerson(e.submittedBy),
    ago: relativeTime(e.createdAt),
    lines: e.lines.map(serializeLine),
    ...totals,
  };
};

// ── Invoice + Payment ────────────────────────────────────────────────────────
type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

export const invoicePaid = (inv: { payments: { amountPaise: number }[] }) =>
  toRupees(inv.payments.reduce((s, p) => s + p.amountPaise, 0));

export const invoiceStatus = (total: number, paid: number): 'PAID' | 'PARTIAL' | 'UNPAID' => {
  if (paid <= 0) return 'UNPAID';
  if (paid >= total) return 'PAID';
  return 'PARTIAL';
};

export const serializeInvoice = (inv: InvoiceRow) => {
  const totals = computeTotals(inv.lines, inv.gstRate);
  const veh = inv.vehicle ?? inv.job?.vehicle ?? null;
  const paid = invoicePaid(inv);
  return {
    id: inv.id,
    number: inv.number,
    date: formatDate(inv.issuedAt),
    issuedAt: isoDate(inv.issuedAt),
    jobId: inv.job?.code ?? undefined,
    customer: shortName(inv.customer.name),
    car: veh ? `${veh.make} ${veh.model}` : '',
    plate: veh?.plate ?? '',
    lines: inv.lines.map(serializeLine),
    ...totals,
    // derived, never stored:
    paid,
    balance: totals.total - paid,
    status: invoiceStatus(totals.total, paid),
  };
};

type PaymentRow = Prisma.PaymentGetPayload<{}>;
export const serializePayment = (p: PaymentRow) => ({
  id: p.id,
  invoiceId: p.invoiceId,
  amount: toRupees(p.amountPaise),
  method: paymentMethodToApi[p.method],
  at: p.at.toISOString(),
});

// ── Expense ──────────────────────────────────────────────────────────────────
type ExpenseRow = Prisma.ExpenseGetPayload<{}>;
export const serializeExpense = (e: ExpenseRow) => ({
  id: e.id,
  title: e.title,
  category: expenseCategoryToApi[e.category],
  amount: toRupees(e.amountPaise),
  at: isoDate(e.spentAt),
});

// ── Pagination (only where the contract is Paginated<T>) ─────────────────────
export const paginate = <T>(items: T[], total: number, page: number, pageSize: number) => ({
  items,
  total,
  page,
  pageSize,
  pageCount: Math.max(1, Math.ceil(total / pageSize)),
});
