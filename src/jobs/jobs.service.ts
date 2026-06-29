import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import {
  jobInclude,
  jobWithTimelineInclude,
  serializeJob,
  serializeTimelineItem,
  serializeRead,
  serializeCompletionPhoto,
  COMPLETION_SIDES,
} from '../common/serializers';
import {
  apiToJobStatus,
  apiToPriority,
  apiToTimelineKind,
  apiToVehicleType,
} from '../common/enum-maps';
import { initialsOf, toPaise } from '../common/format';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { TimelineEntryDto } from './dto/timeline-entry.dto';
import { PartLineDto } from './dto/add-parts.dto';

export type UploadedTimelineFiles = {
  image?: Array<{ originalname: string; buffer: Buffer }>;
  audio?: Array<{ originalname: string; buffer: Buffer }>;
};

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────

  async list(user: AuthUser, status?: string, mine?: string) {
    const where: Prisma.JobWhereInput = {};
    if (status) {
      const mapped = apiToJobStatus[status] ?? apiToJobStatus[status.toUpperCase()];
      if (mapped) where.status = mapped;
    }
    // TECH is always scoped to own jobs; managers/admins see all unless mine=true.
    if (user.role === UserRole.TECH) {
      where.techId = user.id;
    } else if (mine === 'true') {
      where.techId = user.id;
    }
    const jobs = await this.prisma.job.findMany({
      where,
      include: jobInclude,
      orderBy: { createdAt: 'desc' },
    });
    return jobs.map(serializeJob);
  }

  async findOne(code: string) {
    const job = await this.prisma.job.findUnique({
      where: { code },
      include: jobWithTimelineInclude,
    });
    if (!job) throw new NotFoundException('Job not found');
    return {
      ...serializeJob(job),
      timeline: job.timeline.map(serializeTimelineItem),
      reads: job.reads.map(serializeRead),
      completionPhotos: job.completionPhotos.map(serializeCompletionPhoto),
    };
  }

  // Mark the chat as read by the current user up to now. Idempotent upsert of
  // the per-user/per-job read marker.
  async markRead(code: string, user: AuthUser) {
    const job = await this.prisma.job.findUnique({ where: { code }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found');
    await this.prisma.jobRead.upsert({
      where: { userId_jobId: { userId: user.id, jobId: job.id } },
      create: { userId: user.id, jobId: job.id },
      update: { at: new Date() },
    });
    return { message: 'ok' };
  }

  // Save (or replace) one mandatory completion photo for a job side.
  async saveCompletionPhoto(
    code: string,
    side: string,
    file?: { originalname: string; buffer: Buffer },
  ) {
    const job = await this.resolveJob(code);
    const SIDE = side?.toUpperCase();
    if (!COMPLETION_SIDES.includes(SIDE as (typeof COMPLETION_SIDES)[number])) {
      throw new BadRequestException('Invalid side');
    }
    if (!file) throw new BadRequestException('Photo required');
    const url = await this.storage.save(file, `jobs/${job.id}/completion`);
    await this.prisma.completionPhoto.upsert({
      where: { jobId_side: { jobId: job.id, side: SIDE } },
      create: { jobId: job.id, side: SIDE, url },
      update: { url, at: new Date() },
    });
    return this.findOne(code);
  }

  // ── Create job card ──────────────────────────────────────────────────────

  async create(dto: CreateJobDto, user: AuthUser) {
    let vehicleId: string;
    let customerId: string;

    if (dto.vehicleId) {
      const vehicle = await this.prisma.vehicle.findUnique({ where: { id: dto.vehicleId } });
      if (!vehicle) throw new NotFoundException('Vehicle not found');
      vehicleId = vehicle.id;
      customerId = dto.customerId ?? vehicle.customerId;
    } else {
      if (!dto.plate || !dto.make || !dto.model || dto.year === undefined) {
        throw new BadRequestException({
          message: 'Provide a vehicleId or plate + make + model + year',
          errors: { plate: ['Vehicle details required'] },
        });
      }
      customerId = await this.resolveCustomerId(dto);
      const vehicle = await this.prisma.vehicle.create({
        data: {
          customerId,
          plate: dto.plate,
          make: dto.make,
          model: dto.model,
          year: dto.year,
          type: apiToVehicleType(dto.type),
        },
      });
      vehicleId = vehicle.id;
    }

    const code = await this.nextJobCode();
    const job = await this.prisma.job.create({
      data: {
        code,
        vehicleId,
        customerId,
        complaint: dto.complaint,
        odometer: dto.odometer,
        priority: dto.priority ? apiToPriority[dto.priority] : undefined,
        // a tech creating a job takes it; managers/admins assign later
        techId: user.role === UserRole.TECH ? user.id : undefined,
      },
    });

    if (dto.lines?.length) {
      await this.prisma.estimate.create({
        data: {
          jobId: job.id,
          submittedById: user.id,
          gstRate: 18,
          lines: {
            create: dto.lines.map((l) => ({
              label: l.label,
              note: l.note,
              amountPaise: toPaise(l.amount),
            })),
          },
        },
      });
      await this.prisma.job.update({ where: { id: job.id }, data: { status: 'REVIEW' } });
    }

    return this.findOne(code);
  }

  // ── Update (PATCH returns { message } by contract) ────────────────────────

  async update(code: string, dto: UpdateJobDto, user: AuthUser) {
    const job = await this.resolveJob(code);
    if (dto.techId !== undefined && user.role === UserRole.TECH) {
      throw new ForbiddenException('Technicians cannot reassign jobs');
    }
    if (dto.techId) {
      const tech = await this.prisma.user.findUnique({ where: { id: dto.techId } });
      if (!tech) throw new NotFoundException('Technician not found');
    }
    // Gate completion on the four mandatory walk-around photos.
    if (dto.status && apiToJobStatus[dto.status] === 'COMPLETED') {
      const have = await this.prisma.completionPhoto.findMany({
        where: { jobId: job.id },
        select: { side: true },
      });
      const missing = COMPLETION_SIDES.filter((s) => !have.some((p) => p.side === s));
      if (missing.length) {
        throw new BadRequestException({
          message: 'Add all completion photos before marking the job complete',
          errors: { completionPhotos: missing.map((s) => `${s} photo required`) },
        });
      }
    }
    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        ...(dto.status ? { status: apiToJobStatus[dto.status] } : {}),
        ...(dto.progress !== undefined ? { progress: dto.progress } : {}),
        ...(dto.techId !== undefined ? { techId: dto.techId || null } : {}),
        ...(dto.bay !== undefined ? { bay: dto.bay } : {}),
        ...(dto.priority ? { priority: apiToPriority[dto.priority] } : {}),
      },
    });

    // A newly-assigned tech (skip re-assigns to the same person + self-assigns).
    if (dto.techId && dto.techId !== job.techId && dto.techId !== user.id) {
      void this.notifyAssignment(job.id, job.code, dto.techId);
    }
    // Job marked complete → let the office know it's ready for delivery.
    if (dto.status && apiToJobStatus[dto.status] === 'COMPLETED') {
      void this.notifyCompleted(job.id, job.code, user.id);
    }

    return { message: 'Job updated' };
  }

  private async notifyAssignment(jobId: string, jobCode: string, techId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { vehicle: true },
    });
    if (!job) return;
    await this.notifications.pushToUsers([techId], {
      title: 'New job assigned',
      body: `${job.vehicle.make} ${job.vehicle.model} · ${job.vehicle.plate}`,
      data: { type: 'job_assigned', jobCode },
    });
  }

  private async notifyCompleted(jobId: string, jobCode: string, actorId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { vehicle: true },
    });
    if (!job) return;
    await this.notifications.pushToRoles(
      [UserRole.MANAGER, UserRole.ADMIN],
      {
        title: 'Job completed',
        body: `${job.vehicle.plate} is ready for delivery`,
        data: { type: 'job_completed', jobCode },
      },
      actorId,
    );
  }

  // ── Timeline ──────────────────────────────────────────────────────────────

  async addTimeline(
    code: string,
    dto: TimelineEntryDto,
    files: UploadedTimelineFiles,
    user: AuthUser,
  ) {
    const job = await this.resolveJob(code);
    const data: Prisma.JobTimelineEntryCreateInput = {
      job: { connect: { id: job.id } },
      kind: apiToTimelineKind[dto.kind],
    };

    if (dto.kind !== 'system') {
      data.author = { connect: { id: user.id } };
    }

    switch (dto.kind) {
      case 'text':
        data.text = dto.text ?? '';
        break;
      case 'photo':
        data.tag = dto.tag;
        if (files.image?.[0]) {
          data.imageUrl = await this.storage.save(files.image[0], `jobs/${job.id}`);
        }
        break;
      case 'voice':
        data.durationMs = dto.durationMs ?? 0;
        if (files.audio?.[0]) {
          data.audioUrl = await this.storage.save(files.audio[0], `jobs/${job.id}`);
        }
        break;
      case 'part':
        data.partName = dto.partName;
        data.qty = dto.qty ?? 1;
        data.pricePaise = dto.price !== undefined ? toPaise(dto.price) : 0;
        break;
      case 'system':
        data.text = dto.text ?? '';
        data.systemTone = dto.systemTone;
        data.systemIcon = dto.systemIcon;
        break;
    }

    const entry = await this.prisma.jobTimelineEntry.create({
      data,
      include: { author: true },
    });

    // Ping the other participants on a real (non-system) message. Fire-and-forget
    // so chat latency isn't tied to Expo's push endpoint.
    if (dto.kind !== 'system') {
      void this.notifyNewMessage(job.id, job.code, dto.kind, user.id, entry.author?.name ?? 'Someone');
    }

    return serializeTimelineItem(entry);
  }

  // Notify a job's tech + all managers/admins (minus the author) of a new chat
  // message, deep-linking them to the job.
  private async notifyNewMessage(
    jobId: string,
    jobCode: string,
    kind: string,
    authorId: string,
    authorName: string,
  ): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { vehicle: true },
    });
    if (!job) return;

    const preview =
      kind === 'photo'
        ? '📷 Photo'
        : kind === 'voice'
          ? '🎙️ Voice note'
          : kind === 'part'
            ? '🔧 Added a part'
            : 'New message';

    const payload = {
      title: `${authorName} · ${job.vehicle.plate}`,
      body: preview,
      data: { type: 'chat' as const, jobCode },
    };

    // The assigned tech (if they aren't the author).
    if (job.techId && job.techId !== authorId) {
      await this.notifications.pushToUsers([job.techId], payload);
    }
    // Managers + admins watching the floor (minus the author).
    await this.notifications.pushToRoles([UserRole.MANAGER, UserRole.ADMIN], payload, authorId);
  }

  // ── Parts (timeline PART entries + stock decrement) ───────────────────────

  async addParts(code: string, items: PartLineDto[], user: AuthUser) {
    const job = await this.resolveJob(code);
    const created: ReturnType<typeof serializeTimelineItem>[] = [];
    for (const item of items) {
      const cat = await this.prisma.catalogueItem.findUnique({
        where: { id: item.catalogueItemId },
      });
      if (!cat) throw new NotFoundException(`Catalogue item ${item.catalogueItemId} not found`);
      if (cat.stock !== null) {
        await this.prisma.catalogueItem.update({
          where: { id: cat.id },
          data: { stock: Math.max(0, cat.stock - item.qty) },
        });
      }
      const entry = await this.prisma.jobTimelineEntry.create({
        data: {
          jobId: job.id,
          kind: 'PART',
          authorId: user.id,
          partName: cat.name,
          qty: item.qty,
          pricePaise: cat.pricePaise, // unit price; UI shows qty × price
        },
        include: { author: true },
      });
      created.push(serializeTimelineItem(entry));
    }
    return created;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async resolveJob(code: string) {
    const job = await this.prisma.job.findUnique({ where: { code } });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  private async resolveCustomerId(dto: CreateJobDto): Promise<string> {
    if (dto.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
      if (!customer) throw new NotFoundException('Customer not found');
      return customer.id;
    }
    if (dto.customerName) {
      const count = await this.prisma.customer.count();
      const customer = await this.prisma.customer.create({
        data: {
          name: dto.customerName,
          initials: initialsOf(dto.customerName),
          color: ['a', 'b', 'c', 'd', 'e', 'f'][count % 6],
        },
      });
      return customer.id;
    }
    throw new BadRequestException({
      message: 'Provide a customerId or customerName',
      errors: { customer: ['Customer required'] },
    });
  }

  private async nextJobCode(): Promise<string> {
    const count = await this.prisma.job.count();
    let n = count + 1;
    // guard against gaps from deletes
    while (await this.prisma.job.findUnique({ where: { code: `j${n}` } })) n++;
    return `j${n}`;
  }
}
