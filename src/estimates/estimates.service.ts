import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JobEventType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  estimateInclude,
  invoiceInclude,
  serializeApproval,
  serializeInvoice,
} from '../common/serializers';
import { toPaise } from '../common/format';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { JobEventsService } from '../jobs/job-events.service';
import { WorkshopsService } from '../workshops/workshops.service';
import { SubmitEstimateDto } from './dto/submit-estimate.dto';

@Injectable()
export class EstimatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly events: JobEventsService,
    private readonly workshops: WorkshopsService,
  ) {}

  // The workshop's configured GST rate — the default when an estimate doesn't
  // specify one explicitly.
  async defaultGstRate(workshopId: string): Promise<number> {
    try {
      return (await this.workshops.getById(workshopId)).gstRate;
    } catch {
      return 18;
    }
  }

  // Submit (or resubmit) an estimate for a job → sets the job to REVIEW.
  async submit(jobCode: string, dto: SubmitEstimateDto, user: AuthUser) {
    const job = await this.prisma.job.findFirst({
      where: { code: jobCode, workshopId: user.workshopId },
      include: { vehicle: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    // The vehicle is already with the customer — nothing left to estimate.
    if (job.status === 'DELIVERED') {
      throw new BadRequestException('This job is delivered; estimates can no longer be submitted');
    }

    const lineData = dto.lines.map((l) => ({
      label: l.label,
      note: l.note,
      amountPaise: toPaise(l.amount),
    }));

    const gstRate = dto.gstRate ?? (await this.defaultGstRate(user.workshopId));

    // Park the job in REVIEW, remembering where it came from (unless a double
    // submit finds it already parked) so the decision can restore it exactly.
    const parkInReview = this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'REVIEW',
        ...(job.status !== 'REVIEW' ? { statusBeforeReview: job.status } : {}),
      },
    });

    // One estimate per job (jobId @unique): replace lines on resubmit. A
    // resubmission is a fresh request, so it's re-dated — approvals age and
    // sort by the latest submission, and decide() uses createdAt as its
    // optimistic-concurrency version.
    const existing = await this.prisma.estimate.findUnique({ where: { jobId: job.id } });
    if (existing) {
      await this.prisma.$transaction([
        this.prisma.estimateLine.deleteMany({ where: { estimateId: existing.id } }),
        this.prisma.estimate.update({
          where: { id: existing.id },
          data: {
            submittedById: user.id,
            status: 'PENDING',
            gstRate,
            decidedById: null,
            createdAt: new Date(),
            lines: { create: lineData },
          },
        }),
        parkInReview,
      ]);
    } else {
      await this.prisma.$transaction([
        this.prisma.estimate.create({
          data: {
            jobId: job.id,
            submittedById: user.id,
            gstRate,
            lines: { create: lineData },
          },
        }),
        parkInReview,
      ]);
    }

    await this.events.emit(job.id, {
      type: JobEventType.SYSTEM,
      body: 'Estimate submitted for approval',
    });

    // An estimate is now awaiting a decision — ping the approvers.
    void this.notifications.pushToRoles(
      [UserRole.MANAGER, UserRole.ADMIN],
      user.workshopId,
      {
        title: 'Estimate awaiting approval',
        body: `${job.vehicle.make} ${job.vehicle.model} · ${job.vehicle.plate}`,
        data: { type: 'estimate_submitted', jobCode },
      },
      user.id,
    );

    return this.getApproval(jobCode, user.workshopId);
  }

  async listApprovals(workshopId: string) {
    const estimates = await this.prisma.estimate.findMany({
      where: { status: 'PENDING', job: { workshopId } },
      include: estimateInclude,
      orderBy: { createdAt: 'desc' },
    });
    return estimates.map(serializeApproval);
  }

  async getApproval(jobCode: string, workshopId: string) {
    const estimate = await this.prisma.estimate.findFirst({
      where: { job: { code: jobCode, workshopId } },
      include: estimateInclude,
    });
    if (!estimate) throw new NotFoundException('Approval not found');
    return serializeApproval(estimate);
  }

  // Approve → materialise the estimate into the job's invoice + release the job.
  // Decline → back to the tech. Records decidedBy either way.
  async decide(jobCode: string, decision: 'approve' | 'decline', user: AuthUser) {
    const estimate = await this.prisma.estimate.findFirst({
      where: { job: { code: jobCode, workshopId: user.workshopId } },
      include: { ...estimateInclude, job: { include: { vehicle: true, customer: true, invoice: true } } },
    });
    if (!estimate) throw new NotFoundException('Approval not found');
    if (estimate.status !== 'PENDING') {
      throw new ConflictException('This estimate has already been decided');
    }

    // Claim the decision atomically. Matching createdAt pins the exact
    // submission we read above, so a concurrent decision — or a resubmit that
    // slipped in between — makes this a no-op instead of a double decision.
    const claimed = await this.prisma.estimate.updateMany({
      where: { id: estimate.id, status: 'PENDING', createdAt: estimate.createdAt },
      data: {
        status: decision === 'approve' ? 'APPROVED' : 'DECLINED',
        decidedById: user.id,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException('This estimate has already been decided');
    }

    // Either decision releases the job to where it was before REVIEW parked it
    // (legacy rows without the stamp fall back to the startedAt heuristic).
    // The decision doesn't start work — the technician taps "Start work".
    const resumeStatus =
      estimate.job.statusBeforeReview ?? (estimate.job.startedAt ? 'IN_PROGRESS' : 'NOT_STARTED');
    const releaseJob = this.prisma.job.update({
      where: { id: estimate.jobId },
      data: {
        ...(estimate.job.status === 'REVIEW' ? { status: resumeStatus } : {}),
        statusBeforeReview: null,
      },
    });

    if (decision === 'decline') {
      await releaseJob;
      await this.events.emit(estimate.jobId, {
        type: JobEventType.APPROVAL,
        authorId: user.id,
        body: 'Estimate declined · back to technician',
        payload: { decision: 'decline' },
      });
      this.notifyDecision(estimate, jobCode, 'decline', user.id);
      return { message: 'Estimate declined', invoice: null };
    }

    // approve — create the invoice on first approval; on approval of a
    // resubmitted estimate refresh the existing invoice's lines + GST rate
    // instead (paid/balance/status are derived, so payments stay consistent).
    const lines = estimate.lines.map((l) => ({
      label: l.label,
      note: l.note,
      amountPaise: l.amountPaise,
    }));
    let invoiceId = estimate.job.invoice?.id;
    if (invoiceId) {
      await this.prisma.$transaction([
        this.prisma.invoiceLine.deleteMany({ where: { invoiceId } }),
        this.prisma.invoice.update({
          where: { id: invoiceId },
          data: { gstRate: estimate.gstRate, lines: { create: lines } },
        }),
        releaseJob,
      ]);
    } else {
      const number = await this.nextInvoiceNumber(user.workshopId);
      const [invoice] = await this.prisma.$transaction([
        this.prisma.invoice.create({
          data: {
            number,
            workshopId: user.workshopId,
            jobId: estimate.jobId,
            customerId: estimate.job.customerId,
            vehicleId: estimate.job.vehicleId,
            gstRate: estimate.gstRate,
            issuedAt: new Date(),
            lines: { create: lines },
          },
        }),
        releaseJob,
      ]);
      invoiceId = invoice.id;
    }

    await this.events.emit(estimate.jobId, {
      type: JobEventType.APPROVAL,
      authorId: user.id,
      body: 'Approved · released to technician',
      payload: { decision: 'approve' },
    });
    this.notifyDecision(estimate, jobCode, 'approve', user.id);

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: invoiceInclude,
    });
    return { message: 'Estimate approved', invoice: invoice ? serializeInvoice(invoice) : null };
  }

  // Tell the tech who submitted the estimate how it went. `estimate` carries the
  // joined job + vehicle (estimateInclude + job vehicle include in `decide`).
  private notifyDecision(
    estimate: { submittedById: string; job: { vehicle: { plate: string } } },
    jobCode: string,
    decision: 'approve' | 'decline',
    deciderId: string,
  ): void {
    if (estimate.submittedById === deciderId) return; // decided your own estimate
    const approved = decision === 'approve';
    void this.notifications.pushToUsers([estimate.submittedById], {
      title: approved ? 'Estimate approved ✅' : 'Estimate declined',
      body: approved
        ? `${estimate.job.vehicle.plate} · released to you`
        : `${estimate.job.vehicle.plate} · sent back for changes`,
      data: { type: approved ? 'estimate_approved' : 'estimate_declined', jobCode },
    });
  }

  private async nextInvoiceNumber(workshopId: string): Promise<string> {
    let prefix = 'INV';
    try {
      prefix = (await this.workshops.getById(workshopId)).invoicePrefix;
    } catch {
      // no workshop configured yet — keep the default prefix
    }
    const count = await this.prisma.invoice.count({ where: { workshopId } });
    let n = 2048 + count;
    while (await this.prisma.invoice.findUnique({ where: { number: `${prefix}-${n}` } })) n++;
    return `${prefix}-${n}`;
  }
}
