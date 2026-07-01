// Prisma enum ⇄ mobile contract maps. *ToApi serialize (out); apiTo* parse DTO
// input (in). When you add an enum value, update BOTH directions here.
import {
  CatalogueKind,
  ExpenseCategory,
  JobStatus,
  PaymentMethod,
  Priority,
  UserRole,
  VehicleType,
} from '@prisma/client';

// ── Job status → label + tone ────────────────────────────────────────────────
export type Tone = 'gray' | 'blue' | 'green' | 'amber' | 'purple' | 'red';

export const jobStatusToApi: Record<JobStatus, { status: string; tone: Tone }> = {
  IN_PROGRESS: { status: 'IN PROGRESS', tone: 'blue' },
  AWAITING_PART: { status: 'AWAITING PART', tone: 'amber' },
  REVIEW: { status: 'REVIEW', tone: 'purple' },
  COMPLETED: { status: 'COMPLETED', tone: 'green' },
  DELIVERED: { status: 'DELIVERED', tone: 'gray' },
};

export const apiToJobStatus: Record<string, JobStatus> = {
  'IN PROGRESS': JobStatus.IN_PROGRESS,
  IN_PROGRESS: JobStatus.IN_PROGRESS,
  'AWAITING PART': JobStatus.AWAITING_PART,
  AWAITING_PART: JobStatus.AWAITING_PART,
  REVIEW: JobStatus.REVIEW,
  COMPLETED: JobStatus.COMPLETED,
  DELIVERED: JobStatus.DELIVERED,
};

// ── Priority ─────────────────────────────────────────────────────────────────
export const priorityToApi: Record<Priority, 'HIGH' | 'NORMAL'> = {
  HIGH: 'HIGH',
  NORMAL: 'NORMAL',
};
export const apiToPriority: Record<string, Priority> = {
  HIGH: Priority.HIGH,
  NORMAL: Priority.NORMAL,
};

// ── Vehicle type (serialized as the UPPER token the app shows) ────────────────
export const vehicleTypeToApi: Record<VehicleType, string> = {
  HATCHBACK: 'HATCHBACK',
  SEDAN: 'SEDAN',
  SUV: 'SUV',
  MUV: 'MUV',
  OTHER: 'OTHER',
};
export const apiToVehicleType = (v?: string): VehicleType => {
  const key = (v ?? '').toUpperCase();
  return (VehicleType as Record<string, VehicleType>)[key] ?? VehicleType.OTHER;
};

// ── User role → role + label + icon ──────────────────────────────────────────
export const roleToApi: Record<
  UserRole,
  { role: 'tech' | 'manager' | 'admin'; roleLabel: string; roleIcon: string }
> = {
  TECH: { role: 'tech', roleLabel: 'Technician', roleIcon: 'wrench' },
  MANAGER: { role: 'manager', roleLabel: 'Manager', roleIcon: 'shield-check' },
  ADMIN: { role: 'admin', roleLabel: 'Admin', roleIcon: 'crown-simple' },
};
export const apiToRole: Record<string, UserRole> = {
  tech: UserRole.TECH,
  manager: UserRole.MANAGER,
  admin: UserRole.ADMIN,
};

// ── Catalogue kind ───────────────────────────────────────────────────────────
export const catalogueKindToApi: Record<CatalogueKind, 'part' | 'service'> = {
  PART: 'part',
  SERVICE: 'service',
};
export const apiToCatalogueKind: Record<string, CatalogueKind> = {
  part: CatalogueKind.PART,
  service: CatalogueKind.SERVICE,
};

// ── Payment method (Title-case out) ──────────────────────────────────────────
export const paymentMethodToApi: Record<PaymentMethod, 'Cash' | 'UPI' | 'Card'> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
};
export const apiToPaymentMethod: Record<string, PaymentMethod> = {
  Cash: PaymentMethod.CASH,
  cash: PaymentMethod.CASH,
  UPI: PaymentMethod.UPI,
  upi: PaymentMethod.UPI,
  Card: PaymentMethod.CARD,
  card: PaymentMethod.CARD,
};

// ── Expense category (Title-case out) ────────────────────────────────────────
export const expenseCategoryToApi: Record<ExpenseCategory, string> = {
  PARTS: 'Parts',
  SALARIES: 'Salaries',
  RENT: 'Rent',
  UTILITIES: 'Utilities',
  MISC: 'Misc',
};
export const apiToExpenseCategory: Record<string, ExpenseCategory> = {
  Parts: ExpenseCategory.PARTS,
  Salaries: ExpenseCategory.SALARIES,
  Rent: ExpenseCategory.RENT,
  Utilities: ExpenseCategory.UTILITIES,
  Misc: ExpenseCategory.MISC,
};
