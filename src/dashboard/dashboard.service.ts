import { Injectable } from '@nestjs/common';
import { JobEventType, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceService } from '../finance/finance.service';
import {
  jobInclude,
  serializeJob,
} from '../common/serializers';
import { formatTime } from '../common/format';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
  ) {}

  async forUser(user: AuthUser) {
    // TECH lands on jobs, but keep the endpoint role-aware: scope to own jobs.
    const techScope = user.role === UserRole.TECH ? { techId: user.id } : {};

    const [jobsInProgress, awaitingApproval, dueForDelivery, activeJobsRows, summary] =
      await Promise.all([
        this.prisma.job.count({ where: { ...techScope, status: 'IN_PROGRESS' } }),
        user.role === UserRole.TECH
          ? this.prisma.job.count({ where: { ...techScope, status: 'REVIEW' } })
          : this.prisma.estimate.count({ where: { status: 'PENDING' } }),
        this.prisma.job.count({ where: { ...techScope, status: 'COMPLETED' } }),
        this.prisma.job.findMany({
          where: { ...techScope, status: { not: 'COMPLETED' } },
          include: jobInclude,
          orderBy: { updatedAt: 'desc' },
          take: 10,
        }),
        this.finance.summary(),
      ]);

    const activeJobs = activeJobsRows.map(serializeJob);
    const activity = await this.recentActivity(techScope);

    const base = {
      jobsInProgress,
      awaitingApproval,
      dueForDelivery,
      activeJobs,
      activity,
    };

    // Finance figures are manager+ only (the app gates the same).
    if (user.role === UserRole.TECH) {
      return base;
    }
    return {
      ...base,
      outstanding: summary.outstanding,
      revenueThisWeek: summary.revenueThisWeek,
      collectedToday: summary.collectedToday,
    };
  }

  private async recentActivity(techScope: { techId?: string }) {
    const events = await this.prisma.jobCardEvent.findMany({
      where: techScope.techId ? { job: { techId: techScope.techId } } : {},
      include: { author: true, job: { include: { vehicle: true } } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    return events.map((e) => ({
      id: e.id,
      text: this.activityText(e),
      plate: e.job.vehicle.plate,
      by: e.author?.name,
      time: formatTime(e.createdAt),
    }));
  }

  private activityText(e: { type: JobEventType; body: string | null; payload: Prisma.JsonValue }): string {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case JobEventType.COMMENT:
      case JobEventType.SYSTEM:
        return e.body ?? '';
      case JobEventType.PART_ADDED:
        return `Added part · ${payload.partName ?? ''}${payload.qty ? ` ×${payload.qty}` : ''}`;
      case JobEventType.PHOTO:
        return `Photo · ${payload.tag ?? 'attached'}`;
      case JobEventType.STATUS_CHANGE:
        return `Status · ${payload.from ?? ''} → ${payload.to ?? ''}`;
      case JobEventType.APPROVAL:
        return e.body ?? `Estimate ${payload.decision ?? 'updated'}`;
      default:
        return e.body ?? '';
    }
  }
}
