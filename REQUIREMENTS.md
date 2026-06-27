# GarageFlow Backend — Requirements & Build Spec

**Audience:** the agent implementing this backend from an empty repo.
**Status:** the mobile app (`../garageflow`) is built and currently runs entirely
on in-memory mock data (`../garageflow/data/mock.ts`). Your job is to stand up a
backend that serves that exact contract so the app can swap mock → API with
**nothing disconnected**.

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) (patterns) alongside this file
(what to build). Where they ever disagree, this file wins for *scope*,
ARCHITECTURE.md wins for *how*.

---

## 0. TL;DR / mission

1. Build a **NestJS + Prisma + PostgreSQL** API, JWT-auth'd, RBAC by role
   (`TECH` / `MANAGER` / `ADMIN`).
2. The **mobile data model is the contract.** Every response must deserialize
   into the shapes in `../garageflow/data/mock.ts` (to be extracted into a shared
   `../garageflow/types/api.ts` — see §11).
3. **Money is ₹ (paise in DB, whole rupees out). Dates are Indian display
   strings.** GST is first-class.
4. **This spec is self-contained.** The required structure and conventions are
   fully defined here and in ARCHITECTURE.md — don't pull patterns or helpers
   from other projects.
5. Finances (receivables, collections, GST, party ledger, profit) are **derived**
   from invoices + payments + expenses — never stored as snapshots.

---

## 1. The golden rule (contract-first)

> The API emits the shapes the app already consumes. The DB schema may differ;
> the gap is closed in **serializers** only.

```
Postgres row ──Prisma──▶ entity (UPPER_SNAKE enums, paise, DateTime)
                              │
                    src/common/serializers.ts   ◀── the only boundary
                              │
                              ▼
              JSON the app expects (₹ numbers, "26 Jun 2026", status labels + tones)
```

Concretely, the mobile app expects e.g.:

```ts
// Job (list + detail)
{ id, plate, make, model, year, type, bay?, customer: Person, tech?: Person,
  status: "IN PROGRESS", tone: "blue", priority?: "HIGH", complaint?, progress?, amount? }
// Person is { name, initials, color }  (color is an avatar key "a".."f")
// Invoice
{ id, number, date: "26 Jun 2026", issuedAt: "2026-06-26", customer, car, plate,
  lines: [{ label, note, amount }], subtotal, gst, total }
// Payment { id, invoiceId, amount, method: "Cash"|"UPI"|"Card", at: ISO }
```

If a field is wrong, fix the **serializer**, not the screen.

---

## 2. Required project structure & patterns

Standard NestJS. Every feature is a module of the same shape; all
cross-cutting concerns live in `src/common`:

```
src/<feature>/
  <feature>.module.ts       declares controller + service
  <feature>.controller.ts   routes only — thin, delegates to the service
  <feature>.service.ts      Prisma queries + serialize(...)
  dto/*.dto.ts              class-validator DTOs
src/common/
  serializers.ts            row → contract JSON (the ONLY response boundary)
  enum-maps.ts              *ToApi (out) / apiTo* (in) enum maps
  format.ts                 toRupees/toPaise, Indian date strings, initialsOf
  guards/                   JwtAuthGuard (global) + RolesGuard (global)
  decorators/               @Public() @CurrentUser() @Roles()
  filters/                  AllExceptionsFilter → { statusCode, message, errors? }
  storage/                  StorageService (local /uploads, S3-swappable)
src/prisma/                 global PrismaService
```

Cross-cutting requirements (request lifecycle is in ARCHITECTURE.md §2):
- Global `/api` prefix; static `/uploads` un-prefixed.
- Auth is **global** — every route needs a valid Bearer access token unless
  `@Public()`. Roles enforced by a global `RolesGuard` reading `@Roles(...)`;
  **default-deny**. Get the caller via `@CurrentUser()` (`{ id, email, role }`).
- `ValidationPipe` with `whitelist` + `transform`; a field-grouped error factory.
- **Responses only leave through serializers** — never return a raw Prisma row.

**GarageFlow specifics — get these exactly right (full detail in §4–§5):**

| Concern | Requirement |
| --- | --- |
| Currency | **INR** — DB paise (`Int`); DTOs accept rupees (`toPaise` in); serialize a **number of rupees** (`toRupees` out) |
| Dates | `"26 Jun 2026"`, time `"8:30 AM"`, relative `"12m ago"`, month `"June 2026"`; emit raw ISO too where the app needs it |
| Roles | `TECH / MANAGER / ADMIN` → serialized `tech/manager/admin` + `roleLabel` + `roleIcon` |
| Job status | `IN_PROGRESS / AWAITING_PART / REVIEW / COMPLETED` → serialized to a **label and a `tone`** |
| Money model | **Invoice + InvoiceLine + Payment**; paid/balance/status are **derived**, never stored |
| Tax | **GST** 18% → CGST 9% + SGST 9%; powers GSTR-1 / GSTR-3B |
| Estimates | **Estimate + EstimateLine** = the "approval" (line items awaiting manager review) |
| Expenses | **Expense** (category) → drives profit |
| Reports | **receivables, day-book collections, GST summary, party ledger, profit** — all derived |
| Contract | mobile shapes in `../garageflow/data/mock.ts` → extract to `../garageflow/types/api.ts` (§11) |

---

## 3. Tech stack & scaffolding (Milestone 0)

- **NestJS** (TypeScript), **Prisma**, **PostgreSQL**, **JWT** (access + rotating
  refresh), **bcrypt**, **class-validator/transformer**, local disk
  `StorageService` for `/uploads` (S3 later).
- Global prefix `/api`; static `/uploads` un-prefixed.
- `.env`: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `PORT`. Provide `.env.example`,
  `docker-compose.yml` (Postgres), `README.md` (setup + smoke tests).
- Scripts: `prisma:migrate`, `prisma:generate`, `prisma:seed`, `db:reset`,
  `build`, `start:dev`. (`tsconfig.build.json` → `dist/main.js`; see ARCHITECTURE §9.)
- **Init this as a git repo** (the folder currently isn't one).

---

## 4. Domain model — proposed Prisma schema

Money columns are **`Int` paise**. Enums are UPPER_SNAKE. IDs are UUID.
This is the target; refine via migrations as you go.

```prisma
enum UserRole { TECH MANAGER ADMIN }

model Workshop {            // single-tenant for now; powers invoice/GST headers
  id        String @id @default(uuid())
  name      String          // "Main Street Motors"
  gstin     String?         // "27ABCDE1234F1Z5"
  createdAt DateTime @default(now())
}

model User {
  id               String   @id @default(uuid())
  name             String
  email            String   @unique
  passwordHash     String
  role             UserRole @default(TECH)
  phone            String?
  initials         String          // "AP"
  color            String   @default("a")   // avatar key a..f
  avatarUrl        String?
  active           Boolean  @default(true)
  refreshTokenHash String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model Customer {
  id        String  @id @default(uuid())
  name      String
  initials  String
  color     String  @default("c")
  phone     String?
  vehicles  Vehicle[]
  createdAt DateTime @default(now())
}

enum VehicleType { HATCHBACK SEDAN SUV MUV OTHER }
model Vehicle {
  id         String      @id @default(uuid())
  customer   Customer    @relation(fields: [customerId], references: [id], onDelete: Cascade)
  customerId String
  plate      String                    // "DL 3C AT 7788"
  make       String                    // "Tata"
  model      String                    // "Nexon"
  year       Int
  type       VehicleType @default(OTHER)
  jobs       Job[]
}

enum JobStatus { IN_PROGRESS AWAITING_PART REVIEW COMPLETED }   // → label + tone in serializer
enum Priority  { HIGH NORMAL }
model Job {
  id         String     @id @default(uuid())
  code       String     @unique          // "j1"-style short code, or use id
  vehicle    Vehicle    @relation(fields: [vehicleId], references: [id])
  vehicleId  String
  customer   Customer   @relation(fields: [customerId], references: [id])
  customerId String
  tech       User?      @relation(fields: [techId], references: [id])
  techId     String?
  status     JobStatus  @default(IN_PROGRESS)
  bay        String?
  priority   Priority   @default(NORMAL)
  complaint  String?
  odometer   Int?
  progress   Int        @default(0)      // 0-100
  timeline   JobTimelineEntry[]
  estimate   Estimate?
  invoice    Invoice?
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt
}

enum TimelineKind { SYSTEM TEXT PHOTO VOICE PART }
model JobTimelineEntry {
  id         String       @id @default(uuid())
  job        Job          @relation(fields: [jobId], references: [id], onDelete: Cascade)
  jobId      String
  kind       TimelineKind
  author     User?        @relation(fields: [authorId], references: [id])
  authorId   String?
  text       String?      // TEXT / SYSTEM body
  tag        String?      // PHOTO label "BEFORE · BLOWER"
  imageUrl   String?      // PHOTO (S3/local)
  audioUrl   String?      // VOICE
  durationMs Int?         // VOICE
  partName   String?      // PART
  qty        Int?
  pricePaise Int?
  systemTone String?      // "purple" | "green"  (SYSTEM only)
  systemIcon String?      // "shield-check" | "check-circle"
  at         DateTime     @default(now())   // serialized to "8:34 AM"
}

enum CatalogueKind { PART SERVICE }
model CatalogueItem {
  id         String        @id @default(uuid())
  name       String
  sku        String                       // "BRP-091" or "Labour"
  kind       CatalogueKind
  stock      Int?                          // parts only
  pricePaise Int
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

enum EstimateStatus { PENDING APPROVED DECLINED }
model Estimate {                            // the "approval"
  id            String         @id @default(uuid())
  job           Job            @relation(fields: [jobId], references: [id], onDelete: Cascade)
  jobId         String         @unique
  submittedBy   User           @relation(fields: [submittedById], references: [id])
  submittedById String
  status        EstimateStatus @default(PENDING)
  gstRate       Int            @default(18)   // percent
  lines         EstimateLine[]
  decidedBy     User?          @relation("EstimateDecider", fields: [decidedById], references: [id])
  decidedById   String?
  createdAt     DateTime       @default(now())
}
model EstimateLine {
  id          String   @id @default(uuid())
  estimate    Estimate @relation(fields: [estimateId], references: [id], onDelete: Cascade)
  estimateId  String
  label       String                       // "Front brake pads"
  note        String                       // "2 × ₹2,400" or "Labour"
  amountPaise Int
}

model Invoice {
  id         String        @id @default(uuid())
  number     String        @unique          // "INV-2048"
  job        Job?          @relation(fields: [jobId], references: [id])
  jobId      String?       @unique
  customer   Customer      @relation(fields: [customerId], references: [id])
  customerId String
  gstRate    Int           @default(18)
  issuedAt   DateTime                        // → date "26 Jun 2026" + issuedAt ISO
  lines      InvoiceLine[]
  payments   Payment[]
  createdAt  DateTime      @default(now())
  // subtotal/gst/total + paid/balance/status are DERIVED, never stored.
}
model InvoiceLine {
  id          String  @id @default(uuid())
  invoice     Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  invoiceId   String
  label       String
  note        String
  amountPaise Int
}

enum PaymentMethod { CASH UPI CARD }
model Payment {
  id          String        @id @default(uuid())
  invoice     Invoice       @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  invoiceId   String
  amountPaise Int
  method      PaymentMethod
  takenBy     User?         @relation(fields: [takenById], references: [id])
  takenById   String?
  at          DateTime      @default(now())
}

enum ExpenseCategory { PARTS SALARIES RENT UTILITIES MISC }
model Expense {
  id          String          @id @default(uuid())
  title       String
  category    ExpenseCategory
  amountPaise Int
  spentAt     DateTime                        // → "23 Jun 2026" + ISO
  createdBy   User?           @relation(fields: [createdById], references: [id])
  createdById String?
}
```

---

## 5. Conventions (do every time)

- **Money:** DB = paise (`Int`). DTOs accept **rupees**; `toPaise()` on the way
  in. Serializers emit a **number of rupees** via `toRupees()` (the app calls
  `inr(n)` itself). All current data is whole-rupee — no sub-rupee values.
- **GST:** store `gstRate` (percent). Derive per invoice/estimate:
  `subtotal = Σ lines`; `gst = round(subtotal × rate / 100)` **rounded to whole
  rupees**; `total = subtotal + gst`. For CGST/SGST split:
  `cgst = round(gst / 2)`, `sgst = gst − cgst` (so it always ties out).
- **Invoice status is derived** from payments:
  `paid = Σ payments`; `UNPAID` if `paid ≤ 0`, `PAID` if `paid ≥ total`, else
  `PARTIAL`. Never store it.
- **Enums → never raw.** Map in `enum-maps.ts`. `JobStatus` serializes to **both**
  a label and a `tone`:

  | JobStatus | label | tone |
  | --- | --- | --- |
  | IN_PROGRESS | `IN PROGRESS` | blue |
  | AWAITING_PART | `AWAITING PART` | amber |
  | REVIEW | `REVIEW` | purple |
  | COMPLETED | `COMPLETED` | green |

  `PaymentMethod`/`ExpenseCategory` serialize Title-case (`UPI`, `Cash`,
  `Parts`). `UserRole` → `tech/manager/admin` plus `roleLabel` + `roleIcon`
  (`tech→wrench`, `manager→shield-check`, `admin→crown-simple`).
- **Dates (`format.ts`, India, deterministic in UTC):**
  `formatDate → "26 Jun 2026"`, `formatTime → "8:30 AM"`,
  `relativeTime → "12m ago"/"1h ago"`, `monthLabel → "June 2026"`. Where the app
  needs the raw ISO too (`Invoice.issuedAt`, `Payment.at`, ledger `at`), emit it
  unformatted alongside the display string.
- **Person shape:** any embedded user/customer (`Job.customer`, `Job.tech`,
  timeline `by`, estimate `submittedBy`) serializes to `{ name, initials, color }`.
- **Lists:** bare arrays unless the screen needs pagination (customers/search).
- **Errors:** Nest `HttpException`s; field errors as
  `{ message, errors: { field: [msg] } }`.

---

## 6. RBAC matrix

Login lands each role on its home (`tech → jobs`, `manager → dashboard`,
`admin → dashboard`). Enforce with `@Roles(...)`; default-deny.

| Capability | TECH | MANAGER | ADMIN |
| --- | :--: | :--: | :--: |
| View/update **own** assigned jobs, post timeline, add parts | ✅ | ✅ | ✅ |
| View **all** jobs, reassign tech | — | ✅ | ✅ |
| Submit estimate (for approval) | ✅ | ✅ | ✅ |
| **Approve/decline** estimate, generate invoice | — | ✅ | ✅ |
| Invoices, record **payments** | — | ✅ | ✅ |
| **Finances** (receivables, collections, GST, ledgers, profit) | — | ✅ | ✅ |
| **Expenses** (view/add) | — | ✅ | ✅ |
| Catalogue read | ✅ | ✅ | ✅ |
| Catalogue manage (price/stock/new) | — | — | ✅ |
| **Team** management (invite, role, deactivate) | — | — | ✅ |
| Workshop settings (name, GSTIN) | — | — | ✅ |

> The mobile app gates the Finances tab to manager + owner; the API must enforce
> the same — do not rely on the client.

---

## 7. API contract by module

All under `/api`, Bearer-auth unless `@Public()`. → return types reference §1 /
the mobile contract.

### Auth  (`@Public()` except `/me`)
- `POST /auth/login` `{ email, password }` → `{ user, tokens }`
- `POST /auth/refresh` `{ refreshToken }` → `{ tokens }` (rotate)
- `POST /auth/logout` → `204`
- `GET /auth/me` → `User`

### Team / Users  (ADMIN)
- `GET /team` → `TeamMember[]` (name, initials, color, phone, role, roleLabel,
  roleIcon, active/inactive)
- `POST /team` `{ name, email, phone, role }` → `TeamMember`
- `PATCH /team/:id` `{ role?, active? }` → `TeamMember`

### Customers & Vehicles
- `GET /customers?query=` → `Customer[]` (search by name/phone)
- `GET /customers/:id` → `Customer` (+ vehicles)
- `POST /customers` / `PATCH /customers/:id`
- `GET /vehicles?plate=` → `Vehicle[]` (plate search — powers job/new + tech search)
- `GET /vehicles/:id` → `Vehicle`
- `POST /vehicles` `{ customerId, plate, make, model, year, type }`

### Jobs
- `GET /jobs?status=&mine=true` → `Job[]` (TECH `mine` defaults true)
- `GET /jobs/:id` → `Job` **with** `timeline: TimelineItem[]`
- `POST /jobs` (create job card) `{ vehicleId | (plate+make+model+year+type),
  customerId | customerName, complaint?, odometer?, lines?: EstimateLine[] }`
- `PATCH /jobs/:id` `{ status?, progress?, techId?, bay?, priority? }`
  → `{ message }` *(by contract — don't return the Job)*
- `POST /jobs/:id/timeline` (multipart) — text / photo / voice / part entry;
  files on `@UploadedFiles()`, text fields via DTO → returns the created
  `TimelineItem`
- `POST /jobs/:id/parts` `{ items: [{ catalogueItemId, qty }] }` → adds PART
  timeline entries + decrements stock

### Catalogue
- `GET /catalogue?kind=part|service` → `CatalogueItem[]`
- `POST /catalogue` / `PATCH /catalogue/:id` (ADMIN) — price/stock

### Approvals / Estimates
- `GET /approvals` → `Approval[]` (PENDING; `submittedBy`, `ago`, lines,
  subtotal/gst/total) — manager+
- `GET /approvals/:id` → `Approval`
- `POST /jobs/:id/estimate` `{ gstRate?, lines: [{label, note, amount}] }`
  → submits for approval, sets job `REVIEW`
- `POST /approvals/:id/decision` `{ decision: "approve"|"decline" }` →
  on **approve**: create an `Invoice` from the estimate lines, advance the job;
  on **decline**: back to the tech. Records `decidedBy`.

### Invoices & Payments  (manager+)
- `GET /invoices?status=paid|partial|unpaid` → `Invoice[]`
- `GET /invoices/:id` → `Invoice` (+ derived paid/balance/status)
- `POST /invoices/:id/payments` `{ amount, method }` → records `Payment`,
  re-derives status

### Expenses  (manager+)
- `GET /expenses?month=YYYY-MM` → `Expense[]`
- `POST /expenses` `{ title, category, amount, spentAt? }`

### Dashboard  (role-aware)
- `GET /dashboard` → metrics + active jobs + recent activity. Manager/admin:
  `{ jobsInProgress, awaitingApproval, dueForDelivery, outstanding,
  revenueThisWeek, activeJobs: Job[], activity: [...] }`. Counts must match the
  finance/jobs sources (no hard-coded numbers).

### Finance / Reports  (manager+) — all **derived**
- `GET /finance/summary?day=&month=` → `{ outstanding, collectedToday,
  revenueThisWeek }`
- `GET /finance/receivables` → invoices with `balance > 0`, biggest first
- `GET /finance/collections?day=YYYY-MM-DD` → `{ methods: [{method, amount,
  count}], total, count }` (day book)
- `GET /finance/gst?month=YYYY-MM` → `{ taxable, gst, cgst, sgst, count }`
- `GET /finance/profit?month=YYYY-MM` → `{ revenue, expenses, profit }`
- `GET /finance/ledgers` → `Party[]` `{ name, closing, invoices }` (per customer)
- `GET /finance/ledgers/:customerId` → `{ customer, billed, closing,
  entries: LedgerEntry[] }` (running balance: invoice=debit, payment=credit)

> **Exports already work client-side.** `../garageflow/lib/finance/reports.ts`
> builds GSTR-1/GSTR-3B/party-statement CSV+PDF from fetched data. So you only
> need the **data** endpoints above; you do **not** need server-side file export
> (leave as a Phase-2 nicety).

---

## 8. Auth details

- Access JWT (short TTL) + refresh JWT (long TTL, **rotated**, hash stored on
  `User.refreshTokenHash`). `AuthUser = { id, email, role }` via `@CurrentUser()`.
- bcrypt password hashing. Seed users with known dev passwords (document in
  README).
- No public self-register for now (staff are invited by ADMIN via `/team`).

## 9. File uploads

- `StorageService` writes to `/uploads` and returns a URL; timeline photo/voice
  entries store that URL. `POST /jobs/:id/timeline` is multipart — use Nest's
  `FileInterceptor`; text fields still validate through the DTO, files arrive on
  a separate `@UploadedFiles()` param. Keep the abstraction S3-swappable.

## 10. Seed data (`prisma:seed`)

Mirror `../garageflow/data/mock.ts` so the app looks identical on day one:
Workshop "Main Street Motors" (+ GSTIN `27ABCDE1234F1Z5`); the 7 `PEOPLE` as
Users/Customers with their initials+color; jobs j1–j4 (statuses/tones/bays/
priorities/complaints/progress); the j1 & j4 timelines; PARTS + SERVICES
catalogue; TEAM (roles/active/inactive); the 3 APPROVALS as PENDING estimates;
the 4 INVOICES + 3 PAYMENTS; the 4 EXPENSES. Seed must be **re-runnable**
(clear in FK order first). Verify derived numbers reproduce the app: outstanding
**₹22,846**, collected today **₹16,033**, revenue this week **₹32,948**, GST this
month **₹5,931**, profit **₹7,848**, Rakesh K. ledger closing **₹15,400**.

---

## 11. Mobile cutover plan (keep nothing disconnected)

This is the bridge that makes the work real on the app side. Do it as the
**last** milestone, module-by-module behind the existing UI.

1. **Extract the contract.** Move the serialized types out of `data/mock.ts`
   into `../garageflow/types/api.ts` (Job, Person, TimelineItem, CatalogueItem,
   TeamMember, Approval/Estimate, Invoice, Payment, Expense, Party, LedgerEntry,
   plus `AuthResponse`, `ApiError`, `Paginated<T>`). This file becomes the single
   source the backend serializers mirror (update ARCHITECTURE.md's "golden rule"
   pointer to it).
2. **API client + data layer.** Add `lib/api/` (a typed fetch client with the
   Bearer token + refresh) and adopt **React Query** per the app's
   `native-data-fetching` guidance. Replace each `data/mock.ts` export with a
   hook (`useJobs`, `useApprovals`, `useFinanceSummary`, …) that hits the API but
   returns the **same shapes** — screens don't change.
3. **Wire the deferred actions** that are currently UI placeholders: "Record"
   payment → `POST /invoices/:id/payments`; "Add expense" → `POST /expenses`;
   estimate approve/decline → `POST /approvals/:id/decision`.
4. Keep `data/mock.ts` as fixtures for tests/Storybook; delete the derived
   helpers once the endpoints replace them.

---

## 12. Milestones (suggested order for the agent)

- **M0 — Scaffold:** Nest app, Prisma, Postgres, auth, guards, serializer trio,
  storage, `/api`, health route, git init.
- **M1 — Identity:** User/Team + Auth (login/refresh/me) + RBAC.
- **M2 — Operations:** Customers, Vehicles, Catalogue, Jobs + Timeline + Parts.
- **M3 — Approvals→Money:** Estimates/Approvals, Invoices, Payments.
- **M4 — Finances:** all `/finance/*` derived reports + Expenses + Dashboard.
- **M5 — Seed + cutover:** `seed.ts` mirroring the mock; then the mobile
  contract extraction + API client (§11).

Each milestone: `npm run build` clean, seed loads, and `curl`/REST-client smoke
tests prove the JSON matches the mobile contract before moving on.

## 13. Definition of done (per module)

- Endpoints return JSON that deserializes into `types/api.ts` with **no client
  changes** to the screen consuming it.
- RBAC enforced (a TECH token is **403** on finance/approval/team routes).
- Money is rupees-out/paise-in; dates are the Indian display strings; enums never
  leak raw.
- Derived figures match the seed assertions in §10.

## 14. Out of scope / deferred (don't build unless asked)

- **Server-side double-entry accounting** (journal / chart of accounts / trial
  balance). GarageFlow is intentionally single-entry now; the auditable journal
  is a future backend project. Today's reports are projections of
  invoices/payments/expenses.
- **Input GST credit** (tax paid on Parts expenses) — current GST report is
  output-tax only.
- Server-side CSV/PDF export (client already does it, §7).
- Multi-workshop tenancy, customer-facing self-approval, push notifications.
```
