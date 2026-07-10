import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

// Mirrors ../garageflow/data/mock.ts so the app looks identical on day one.
// Re-runnable: clears in FK order first. Verifies the §10 derived figures.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const rupees = (n: number) => n * 100; // → paise
const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000';
const DEV_PASSWORD = 'password123';
const utc = (s: string) => new Date(`${s}.000Z`);
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function clear() {
  await prisma.payment.deleteMany();
  await prisma.invoiceLine.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.estimateLine.deleteMany();
  await prisma.estimate.deleteMany();
  await prisma.jobCardEvent.deleteMany();
  await prisma.job.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.catalogueItem.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workshop.deleteMany();
}

async function main() {
  await clear();
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  const workshop = await prisma.workshop.create({
    data: { name: 'Main Street Motors', gstin: '27ABCDE1234F1Z5' },
  });
  const workshopId = workshop.id;

  // ── Team (Users) ───────────────────────────────────────────────────────────
  const kamal = await prisma.user.create({
    data: { workshopId, name: 'Kamal Khushwaha', email: 'admin@garageflow.test', passwordHash, role: 'ADMIN', phone: '+91 98200 11223', initials: 'VK', color: 'f', active: true },
  });
  const rashid = await prisma.user.create({
    data: { workshopId, name: 'Rashid Pathan', email: 'manager@garageflow.test', passwordHash, role: 'MANAGER', phone: '+91 98201 44556', initials: 'RP', color: 'b', active: true },
  });
  const arjun = await prisma.user.create({
    data: { workshopId, name: 'Arjun Patel', email: 'arjun@garageflow.test', passwordHash, role: 'TECH', initials: 'AP', color: 'a', active: true },
  });
  const suresh = await prisma.user.create({
    data: { workshopId, name: 'Suresh Verma', email: 'suresh@garageflow.test', passwordHash, role: 'TECH', initials: 'SV', color: 'd', active: true },
  });
  await prisma.user.create({
    data: { workshopId, name: 'Ramesh Nair', email: 'ramesh@garageflow.test', passwordHash, role: 'TECH', initials: 'Rn', color: 'e', active: false },
  });

  // ── Customers ──────────────────────────────────────────────────────────────
  const rakesh = await prisma.customer.create({ data: { workshopId, name: 'Rakesh Kumar', initials: 'RK', color: 'c', phone: '+91 99300 10101' } });
  const sneha = await prisma.customer.create({ data: { workshopId, name: 'Sneha Desai', initials: 'SD', color: 'b', phone: '+91 99300 20202' } });
  const imran = await prisma.customer.create({ data: { workshopId, name: 'Imran Shaikh', initials: 'IS', color: 'e', phone: '+91 99300 30303' } });

  // ── Vehicles ───────────────────────────────────────────────────────────────
  const swift = await prisma.vehicle.create({ data: { workshopId, customerId: rakesh.id, plate: 'MH 02 AB 1234', make: 'Maruti', model: 'Swift', year: 2021, type: 'HATCHBACK' } });
  const creta = await prisma.vehicle.create({ data: { workshopId, customerId: sneha.id, plate: 'GJ 01 KK 0921', make: 'Hyundai', model: 'Creta', year: 2022, type: 'SUV' } });
  const nexon = await prisma.vehicle.create({ data: { workshopId, customerId: rakesh.id, plate: 'DL 3C AT 7788', make: 'Tata', model: 'Nexon', year: 2020, type: 'SUV' } });
  const city = await prisma.vehicle.create({ data: { workshopId, customerId: rakesh.id, plate: 'KA 05 MN 4521', make: 'Honda', model: 'City', year: 2019, type: 'SEDAN' } });
  const imranSwift = await prisma.vehicle.create({ data: { workshopId, customerId: imran.id, plate: 'MH 12 DE 8890', make: 'Maruti', model: 'Swift', year: 2018, type: 'HATCHBACK' } });

  // ── Jobs ───────────────────────────────────────────────────────────────────
  const j1 = await prisma.job.create({
    data: { workshopId, code: 'j1', vehicleId: swift.id, customerId: rakesh.id, techId: arjun.id, status: 'IN_PROGRESS', startedAt: minsAgo(90), bay: 'BAY 2', priority: 'HIGH', complaint: 'AC not cooling, strange noise from blower', progress: 65 },
  });
  const j2 = await prisma.job.create({
    // Work started, then extra work surfaced → estimate resubmitted, so the job
    // is parked in REVIEW until the office decides (resumes IN_PROGRESS on approve).
    data: { workshopId, code: 'j2', vehicleId: creta.id, customerId: sneha.id, techId: suresh.id, status: 'REVIEW', statusBeforeReview: 'IN_PROGRESS', startedAt: minsAgo(120), bay: 'BAY 4', priority: 'NORMAL', complaint: 'Periodic service + AC gas top-up', progress: 40 },
  });
  const j3 = await prisma.job.create({
    data: { workshopId, code: 'j3', vehicleId: nexon.id, customerId: rakesh.id, status: 'REVIEW', statusBeforeReview: 'NOT_STARTED', priority: 'NORMAL', complaint: 'Brakes squealing, soft pedal', progress: 0 },
  });
  const j4 = await prisma.job.create({
    data: { workshopId, code: 'j4', vehicleId: city.id, customerId: rakesh.id, techId: arjun.id, status: 'COMPLETED', startedAt: minsAgo(240), priority: 'NORMAL', progress: 100 },
  });

  // ── Estimates / Approvals (PENDING) ────────────────────────────────────────
  await prisma.estimate.create({
    data: {
      jobId: j3.id, submittedById: arjun.id, status: 'PENDING', gstRate: 18, createdAt: minsAgo(12),
      lines: { create: [
        { label: 'Brake pad replacement', note: 'Labour', amountPaise: rupees(1800) },
        { label: 'Front brake pads', note: '2 × ₹2,400', amountPaise: rupees(4800) },
        { label: 'Brake fluid flush', note: 'Labour', amountPaise: rupees(900) },
        { label: 'Suspension inspection', note: 'Labour', amountPaise: rupees(4534) },
      ] },
    },
  });
  await prisma.estimate.create({
    data: {
      jobId: j2.id, submittedById: suresh.id, status: 'PENDING', gstRate: 18, createdAt: minsAgo(44),
      lines: { create: [
        { label: 'AC service & gas top-up', note: 'Labour', amountPaise: rupees(1500) },
        { label: 'Cabin air filter', note: '1 × ₹650', amountPaise: rupees(650) },
        { label: 'AC compressor belt', note: '1 × ₹420', amountPaise: rupees(420) },
      ] },
    },
  });
  // j1 has no estimate yet — a walk-in Arjun started directly; he'll submit
  // one once the diagnosis is done. j4 rolled through the whole flow:
  // approved estimate → invoice INV-2048.
  await prisma.estimate.create({
    data: {
      jobId: j4.id, submittedById: arjun.id, status: 'APPROVED', decidedById: rashid.id, gstRate: 18, createdAt: utc('2026-06-26T11:00:00'),
      lines: { create: [
        { label: 'Brake pad replacement', note: 'Labour', amountPaise: rupees(1800) },
        { label: 'Front brake pads', note: '2 × ₹2,400', amountPaise: rupees(4800) },
        { label: 'Brake fluid flush', note: 'Labour', amountPaise: rupees(900) },
        { label: 'Wheel alignment', note: 'Labour', amountPaise: rupees(4534) },
      ] },
    },
  });

  // ── Timelines / events (j1 + j4) ───────────────────────────────────────────
  await prisma.jobCardEvent.createMany({
    data: [
      { jobId: j1.id, type: 'SYSTEM', body: 'Arjun Patel has started work', payload: { kind: 'work_started' }, createdAt: utc('2026-06-27T08:30:00') },
      { jobId: j1.id, type: 'COMMENT', authorId: arjun.id, body: 'Customer says noise starts after 10 min of driving. Please check blower motor first.', createdAt: utc('2026-06-27T08:34:00') },
      { jobId: j1.id, type: 'PHOTO', authorId: arjun.id, payload: { tag: 'BEFORE · BLOWER', url: `${publicUrl}/uploads/seed/blower-before.jpg` }, createdAt: utc('2026-06-27T08:52:00') },
      { jobId: j1.id, type: 'PART_ADDED', authorId: arjun.id, payload: { partName: 'Blower Motor Assembly', qty: 1, pricePaise: rupees(2400) }, createdAt: utc('2026-06-27T09:12:00') },

      { jobId: j4.id, type: 'SYSTEM', body: 'Approved · released to Arjun', createdAt: utc('2026-06-26T11:18:00') },
      { jobId: j4.id, type: 'COMMENT', authorId: arjun.id, body: 'Brake pads replaced, fluid flushed. Test drive done — pedal firm now.', createdAt: utc('2026-06-26T11:20:00') },
      { jobId: j4.id, type: 'PHOTO', authorId: arjun.id, payload: { tag: 'AFTER · BRAKES', url: `${publicUrl}/uploads/seed/brakes-after.jpg` }, createdAt: utc('2026-06-26T11:22:00') },
      { jobId: j4.id, type: 'STATUS_CHANGE', authorId: arjun.id, payload: { from: 'IN PROGRESS', to: 'COMPLETED' }, createdAt: utc('2026-06-26T11:25:00') },
    ],
  });

  // ── Catalogue ──────────────────────────────────────────────────────────────
  await prisma.catalogueItem.createMany({
    data: [
      { name: 'Blower Motor Assembly', sku: 'BLM-204', kind: 'PART', stock: 6, pricePaise: rupees(2400) },
      { name: 'Front Brake Pads', sku: 'BRP-091', kind: 'PART', stock: 14, pricePaise: rupees(2400) },
      { name: 'Cabin Air Filter', sku: 'CAF-110', kind: 'PART', stock: 22, pricePaise: rupees(650) },
      { name: 'Engine Oil 5W-30 (1L)', sku: 'EO-530', kind: 'PART', stock: 30, pricePaise: rupees(520) },
      { name: 'AC Compressor Belt', sku: 'ACB-077', kind: 'PART', stock: 9, pricePaise: rupees(420) },
      { name: 'Brake pad replacement', sku: 'Labour', kind: 'SERVICE', pricePaise: rupees(1800) },
      { name: 'AC service & gas top-up', sku: 'Labour', kind: 'SERVICE', pricePaise: rupees(1500) },
      { name: 'Periodic service (full)', sku: 'Labour', kind: 'SERVICE', pricePaise: rupees(3200) },
      { name: 'Brake fluid flush', sku: 'Labour', kind: 'SERVICE', pricePaise: rupees(900) },
    ],
  });

  // ── Invoices ───────────────────────────────────────────────────────────────
  const inv2048 = await prisma.invoice.create({
    data: {
      workshopId, number: 'INV-2048', jobId: j4.id, customerId: rakesh.id, vehicleId: city.id, gstRate: 18, issuedAt: utc('2026-06-26T00:00:00'),
      lines: { create: [
        { label: 'Brake pad replacement', note: 'Labour', amountPaise: rupees(1800) },
        { label: 'Front brake pads', note: '2 × ₹2,400', amountPaise: rupees(4800) },
        { label: 'Brake fluid flush', note: 'Labour', amountPaise: rupees(900) },
        { label: 'Wheel alignment', note: 'Labour', amountPaise: rupees(4534) },
      ] },
    },
  });
  const inv2049 = await prisma.invoice.create({
    data: {
      workshopId, number: 'INV-2049', customerId: sneha.id, vehicleId: creta.id, gstRate: 18, issuedAt: utc('2026-06-27T00:00:00'),
      lines: { create: [
        { label: 'AC service & gas top-up', note: 'Labour', amountPaise: rupees(1500) },
        { label: 'Cabin air filter', note: '1 × ₹650', amountPaise: rupees(650) },
        { label: 'AC compressor belt', note: '1 × ₹420', amountPaise: rupees(420) },
      ] },
    },
  });
  await prisma.invoice.create({
    data: {
      workshopId, number: 'INV-2050', customerId: imran.id, vehicleId: imranSwift.id, gstRate: 18, issuedAt: utc('2026-06-23T00:00:00'),
      lines: { create: [
        { label: 'Periodic service (full)', note: 'Labour', amountPaise: rupees(3200) },
        { label: 'Engine oil 5W-30', note: '4 × ₹520', amountPaise: rupees(2080) },
        { label: 'Cabin air filter', note: '1 × ₹650', amountPaise: rupees(650) },
        { label: 'Oil filter', note: '1 × ₹380', amountPaise: rupees(380) },
      ] },
    },
  });
  const inv2051 = await prisma.invoice.create({
    data: {
      workshopId, number: 'INV-2051', customerId: rakesh.id, vehicleId: nexon.id, gstRate: 18, issuedAt: utc('2026-06-27T00:00:00'),
      lines: { create: [
        { label: 'Brake pad replacement', note: 'Labour', amountPaise: rupees(1800) },
        { label: 'Front brake pads', note: '2 × ₹2,400', amountPaise: rupees(4800) },
        { label: 'Brake fluid flush', note: 'Labour', amountPaise: rupees(900) },
        { label: 'Suspension inspection', note: 'Labour', amountPaise: rupees(4534) },
      ] },
    },
  });

  // ── Payments (today = 2026-06-27) ──────────────────────────────────────────
  await prisma.payment.createMany({
    data: [
      { invoiceId: inv2048.id, amountPaise: rupees(8000), method: 'UPI', takenById: rashid.id, at: utc('2026-06-27T11:40:00') },
      { invoiceId: inv2049.id, amountPaise: rupees(3033), method: 'CASH', takenById: rashid.id, at: utc('2026-06-27T10:05:00') },
      { invoiceId: inv2051.id, amountPaise: rupees(5000), method: 'CARD', takenById: rashid.id, at: utc('2026-06-27T09:20:00') },
    ],
  });

  // ── Expenses (June 2026) ───────────────────────────────────────────────────
  await prisma.expense.createMany({
    data: [
      { title: 'Parts restock — brake pads, filters', category: 'PARTS', amountPaise: rupees(12500), spentAt: utc('2026-06-20T00:00:00'), createdById: rashid.id },
      { title: 'Staff advance — Suresh', category: 'SALARIES', amountPaise: rupees(6000), spentAt: utc('2026-06-18T00:00:00'), createdById: rashid.id },
      { title: 'Electricity bill', category: 'UTILITIES', amountPaise: rupees(4200), spentAt: utc('2026-06-15T00:00:00'), createdById: rashid.id },
      { title: 'Shop supplies & consumables', category: 'MISC', amountPaise: rupees(2400), spentAt: utc('2026-06-22T00:00:00'), createdById: rashid.id },
    ],
  });

  // A second workshop the admin can switch into (empty tenant, demonstrates
  // the workshop switcher without mixing data into the seeded jobs above).
  const secondWorkshop = await prisma.workshop.create({
    data: { name: 'Highway Auto Care', invoicePrefix: 'HWY' },
  });
  await prisma.workshopAccess.create({
    data: { userId: kamal.id, workshopId: secondWorkshop.id },
  });

  console.log('Seed complete. Dev login password for all users:', DEV_PASSWORD);
  console.log('  admin@garageflow.test · manager@garageflow.test · arjun@garageflow.test');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
