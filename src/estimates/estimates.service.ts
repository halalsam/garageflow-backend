import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
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
  async defaultGstRate(): Promise<number> {
    try {
      return (await this.workshops.activeRow()).gstRate;
    } catch {
      return 18;
    }
  }

  // Submit (or resubmit) an estimate for a job → sets the job to REVIEW.
  async submit(jobCode: string, dto: SubmitEstimateDto, user: AuthUser) {
    const job = await this.prisma.job.findUnique({
      where: { code: jobCode },
      include: { vehicle: true },
    });
    if (!job) throw new NotFoundException('Job not found');

    const lineData = dto.lines.map((l) => ({
      label: l.label,
      note: l.note,
      amountPaise: toPaise(l.amount),
    }));

    const gstRate = dto.gstRate ?? (await this.defaultGstRate());

    // One estimate per job (jobId @unique): replace lines on resubmit.
    const existing = await this.prisma.estimate.findUnique({ where: { jobId: job.id } });
    if (existing) {
      await this.prisma.estimateLine.deleteMany({ where: { estimateId: existing.id } });
      await this.prisma.estimate.update({
        where: { id: existing.id },
        data: {
          submittedById: user.id,
          status: 'PENDING',
          gstRate,
          decidedById: null,
          lines: { create: lineData },
        },
      });
    } else {
      await this.prisma.estimate.create({
        data: {
          jobId: job.id,
          submittedById: user.id,
          gstRate,
          lines: { create: lineData },
        },
      });
    }

    await this.prisma.job.update({ where: { id: job.id }, data: { status: 'REVIEW' } });

    await this.events.emit(job.id, {
      type: JobEventType.SYSTEM,
      body: 'Estimate submitted for approval',
    });

    // An estimate is now awaiting a decision — ping the approvers.
    void this.notifications.pushToRoles(
      [UserRole.MANAGER, UserRole.ADMIN],
      {
        title: 'Estimate awaiting approval',
        body: `${job.vehicle.make} ${job.vehicle.model} · ${job.vehicle.plate}`,
        data: { type: 'estimate_submitted', jobCode },
      },
      user.id,
    );

    return this.getApproval(jobCode);
  }

  async listApprovals() {
    const estimates = await this.prisma.estimate.findMany({
      where: { status: 'PENDING' },
      include: estimateInclude,
      orderBy: { createdAt: 'desc' },
    });
    return estimates.map(serializeApproval);
  }

  async getApproval(jobCode: string) {
    const estimate = await this.prisma.estimate.findFirst({
      where: { job: { code: jobCode } },
      include: estimateInclude,
    });
    if (!estimate) throw new NotFoundException('Approval not found');
    return serializeApproval(estimate);
  }

  // Approve → generate an Invoice from the estimate + advance the job.
  // Decline → back to the tech. Records decidedBy either way.
  async decide(jobCode: string, decision: 'approve' | 'decline', user: AuthUser) {
    const estimate = await this.prisma.estimate.findFirst({
      where: { job: { code: jobCode } },
      include: { ...estimateInclude, job: { include: { vehicle: true, customer: true, invoice: true } } },
    });
    if (!estimate) throw new NotFoundException('Approval not found');
    if (estimate.status !== 'PENDING') {
      throw new ConflictException('This estimate has already been decided');
    }

    if (decision === 'decline') {
      await this.prisma.estimate.update({
        where: { id: estimate.id },
        data: { status: 'DECLINED', decidedById: user.id },
      });
      await this.prisma.job.update({
        where: { id: estimate.jobId },
        data: { status: 'IN_PROGRESS' },
      });
      await this.events.emit(estimate.jobId, {
        type: JobEventType.APPROVAL,
        authorId: user.id,
        body: 'Estimate declined · back to technician',
        payload: { decision: 'decline' },
      });
      this.notifyDecision(estimate, jobCode, 'decline', user.id);
      return { message: 'Estimate declined', invoice: null };
    }

    // approve
    await this.prisma.estimate.update({
      where: { id: estimate.id },
      data: { status: 'APPROVED', decidedById: user.id },
    });

    let invoiceId = estimate.job.invoice?.id;
    if (!invoiceId) {
      const number = await this.nextInvoiceNumber();
      const invoice = await this.prisma.invoice.create({
        data: {
          number,
          jobId: estimate.jobId,
          customerId: estimate.job.customerId,
          vehicleId: estimate.job.vehicleId,
          gstRate: estimate.gstRate,
          issuedAt: new Date(),
          lines: {
            create: estimate.lines.map((l) => ({
              label: l.label,
              note: l.note,
              amountPaise: l.amountPaise,
            })),
          },
        },
      });
      invoiceId = invoice.id;
    }

    await this.prisma.job.update({
      where: { id: estimate.jobId },
      data: { status: 'IN_PROGRESS' },
    });
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

  private async nextInvoiceNumber(): Promise<string> {
    let prefix = 'INV';
    try {
      prefix = (await this.workshops.activeRow()).invoicePrefix;
    } catch {
      // no workshop configured yet — keep the default prefix
    }
    const count = await this.prisma.invoice.count();
    let n = 2048 + count;
    while (await this.prisma.invoice.findUnique({ where: { number: `${prefix}-${n}` } })) n++;
    return `${prefix}-${n}`;
  }
}
