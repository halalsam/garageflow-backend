import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JobEventType, JobStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import {
  jobInclude,
  jobDetailInclude,
  serializeJob,
  serializeRead,
  serializeCompletionPhoto,
  serializeDeliveryPhoto,
  COMPLETION_SIDES,
} from '../common/serializers';
import {
  apiToJobStatus,
  apiToPriority,
  apiToVehicleType,
  jobStatusToApi,
} from '../common/enum-maps';
import { initialsOf, toPaise } from '../common/format';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { EstimatesService } from '../estimates/estimates.service';
import { JobEventsService } from './job-events.service';
import { assertJobAccess } from './job-access';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsDto } from './dto/list-events.dto';
import { PartLineDto } from './dto/add-parts.dto';

// The job lifecycle a PATCH may drive. REVIEW and NOT_STARTED are entered by
// the estimate flow (submit → REVIEW, decision → back), never by the client;
// DELIVERED is terminal.
const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  NOT_STARTED: [JobStatus.IN_PROGRESS],
  REVIEW: [],
  IN_PROGRESS: [JobStatus.AWAITING_PART, JobStatus.COMPLETED],
  AWAITING_PART: [JobStatus.IN_PROGRESS, JobStatus.COMPLETED],
  COMPLETED: [JobStatus.IN_PROGRESS, JobStatus.DELIVERED],
  DELIVERED: [],
};

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly events: JobEventsService,
    private readonly estimates: EstimatesService,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────

  async list(user: AuthUser, status?: string, mine?: string) {
    const where: Prisma.JobWhereInput = { workshopId: user.workshopId };
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

  async findOne(code: string, workshopId: string) {
    const job = await this.prisma.job.findFirst({
      where: { code, workshopId },
      include: jobDetailInclude,
    });
    if (!job) throw new NotFoundException('Job not found');
    return {
      ...serializeJob(job),
      // Phone powers the manager's call / WhatsApp actions; not on the generic
      // Person shape so it only rides the detail payload.
      customerPhone: job.customer.phone ?? undefined,
      reads: job.reads.map(serializeRead),
      completionPhotos: job.completionPhotos.map(serializeCompletionPhoto),
      deliveryPhotos: job.deliveryPhotos.map(serializeDeliveryPhoto),
      deliveryNote: job.deliveryNote ?? undefined,
      deliveryNoteAudioUrl: job.deliveryNoteAudioUrl ?? undefined,
    };
  }

  // Mark the chat as read by the current user up to now. Idempotent upsert of
  // the per-user/per-job read marker.
  async markRead(code: string, user: AuthUser) {
    const job = await this.resolveJob(code, user.workshopId);
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
    user: AuthUser,
    side: string,
    file?: { originalname: string; buffer: Buffer },
  ) {
    const job = await this.resolveJob(code, user.workshopId);
    const SIDE = this.validSide(side);
    if (!file) throw new BadRequestException('Photo required');
    const url = await this.storage.save(file, `jobs/${job.id}/completion`);
    await this.prisma.completionPhoto.upsert({
      where: { jobId_side: { jobId: job.id, side: SIDE } },
      create: { jobId: job.id, side: SIDE, url },
      update: { url, at: new Date() },
    });
    return this.findOne(code, user.workshopId);
  }

  // Save (or replace) one mandatory delivery walk-around photo for a job side.
  async saveDeliveryPhoto(
    code: string,
    user: AuthUser,
    side: string,
    file?: { originalname: string; buffer: Buffer },
  ) {
    const job = await this.resolveJob(code, user.workshopId);
    const SIDE = this.validSide(side);
    if (!file) throw new BadRequestException('Photo required');
    const url = await this.storage.save(file, `jobs/${job.id}/delivery`);
    await this.prisma.deliveryPhoto.upsert({
      where: { jobId_side: { jobId: job.id, side: SIDE } },
      create: { jobId: job.id, side: SIDE, url },
      update: { url, at: new Date() },
    });
    return this.findOne(code, user.workshopId);
  }

  private validSide(side: string): (typeof COMPLETION_SIDES)[number] {
    const SIDE = side?.toUpperCase() as (typeof COMPLETION_SIDES)[number];
    if (!COMPLETION_SIDES.includes(SIDE)) throw new BadRequestException('Invalid side');
    return SIDE;
  }

  // ── Create job card ──────────────────────────────────────────────────────

  async create(dto: CreateJobDto, user: AuthUser) {
    let vehicleId: string;
    let customerId: string;

    if (dto.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, workshopId: user.workshopId },
      });
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
      customerId = await this.resolveCustomerId(dto, user.workshopId);
      const vehicle = await this.prisma.vehicle.create({
        data: {
          workshopId: user.workshopId,
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
        workshopId: user.workshopId,
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
          gstRate: await this.estimates.defaultGstRate(user.workshopId),
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

    return this.findOne(code, user.workshopId);
  }

  // ── Update (PATCH returns { message } by contract) ────────────────────────

  async update(code: string, dto: UpdateJobDto, user: AuthUser) {
    const job = await this.resolveJob(code, user.workshopId);
    if (dto.techId !== undefined && user.role === UserRole.TECH) {
      throw new ForbiddenException('Technicians cannot reassign jobs');
    }
    const newStatus = dto.status ? apiToJobStatus[dto.status] : undefined;
    if (newStatus && newStatus !== job.status) {
      // Nothing moves while an estimate is awaiting a decision; the decision
      // itself (estimates.service) releases the job.
      if (job.status === 'REVIEW') {
        throw new BadRequestException(
          'Estimate is awaiting approval — work can continue once it is decided',
        );
      }
      if (!ALLOWED_TRANSITIONS[job.status].includes(newStatus)) {
        throw new BadRequestException(
          `A ${jobStatusToApi[job.status].status} job can't move to ${jobStatusToApi[newStatus].status}`,
        );
      }
    }
    const startingNow = newStatus === 'IN_PROGRESS' && !job.startedAt;
    if (dto.techId) {
      const tech = await this.prisma.user.findFirst({
        where: { id: dto.techId, workshopId: user.workshopId },
      });
      if (!tech) throw new NotFoundException('Technician not found');
    }
    // Arrival photos are captured when the job card is created, so completion
    // is no longer gated on them (legacy jobs without photos stay completable).
    // Gate delivery on the four mandatory delivery walk-around photos + a
    // hand-off note (typed or a voice recording).
    const deliverdNow = dto.status && apiToJobStatus[dto.status] === 'DELIVERED';
    if (deliverdNow) {
      const have = await this.prisma.deliveryPhoto.findMany({
        where: { jobId: job.id },
        select: { side: true },
      });
      const missing = COMPLETION_SIDES.filter((s) => !have.some((p) => p.side === s));
      if (missing.length) {
        throw new BadRequestException({
          message: 'Add all delivery photos before marking the vehicle delivered',
          errors: { deliveryPhotos: missing.map((s) => `${s} photo required`) },
        });
      }
      if (!dto.deliveryNote?.trim() && !dto.deliveryNoteAudioUrl?.trim()) {
        throw new BadRequestException({
          message: 'Add a hand-off note (text or voice) before delivering',
          errors: { deliveryNote: ['A delivery note is required'] },
        });
      }
    }
    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        ...(dto.status ? { status: apiToJobStatus[dto.status] } : {}),
        ...(startingNow ? { startedAt: new Date() } : {}),
        ...(dto.progress !== undefined ? { progress: dto.progress } : {}),
        ...(dto.techId !== undefined ? { techId: dto.techId || null } : {}),
        ...(dto.bay !== undefined ? { bay: dto.bay } : {}),
        ...(dto.priority ? { priority: apiToPriority[dto.priority] } : {}),
        ...(deliverdNow
          ? {
              deliveredAt: new Date(),
              deliveredById: user.id,
              deliveryNote: dto.deliveryNote?.trim() || null,
              deliveryNoteAudioUrl: dto.deliveryNoteAudioUrl?.trim() || null,
            }
          : {}),
      },
    });

    // Record an actual status transition on the timeline. The first move into
    // IN_PROGRESS reads as "<tech> has started work" instead of a status pill.
    if (newStatus && newStatus !== job.status) {
      if (startingNow) {
        const author = await this.prisma.user.findUnique({
          where: { id: user.id },
          select: { name: true },
        });
        await this.events.emit(job.id, {
          type: JobEventType.SYSTEM,
          body: `${author?.name ?? 'Technician'} has started work`,
          payload: { kind: 'work_started' },
        });
      } else {
        await this.events.emit(job.id, {
          type: JobEventType.STATUS_CHANGE,
          authorId: user.id,
          payload: {
            from: jobStatusToApi[job.status].status,
            to: jobStatusToApi[newStatus].status,
          },
        });
      }
    }

    // A newly-assigned tech (skip re-assigns to the same person + self-assigns).
    if (dto.techId && dto.techId !== job.techId && dto.techId !== user.id) {
      void this.notifyAssignment(job.id, job.code, dto.techId);
    }
    // Job marked complete → let the office know it's ready for delivery.
    if (dto.status && apiToJobStatus[dto.status] === 'COMPLETED') {
      void this.notifyCompleted(job.id, job.code, user.id);
    }
    // Vehicle handed to the customer → log it on the timeline + notify the office.
    if (newStatus === 'DELIVERED' && job.status !== 'DELIVERED') {
      await this.events.emit(job.id, {
        type: JobEventType.SYSTEM,
        body: 'Vehicle delivered to customer',
      });
      void this.notifyDelivered(job.id, job.code, user.id);
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
      job.workshopId,
      {
        title: 'Job completed',
        body: `${job.vehicle.plate} is ready for delivery`,
        data: { type: 'job_completed', jobCode },
      },
      actorId,
    );
  }

  private async notifyDelivered(jobId: string, jobCode: string, actorId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { vehicle: true },
    });
    if (!job) return;
    await this.notifications.pushToRoles(
      [UserRole.MANAGER, UserRole.ADMIN],
      job.workshopId,
      {
        title: 'Vehicle delivered',
        body: `${job.vehicle.plate} was delivered to the customer`,
        data: { type: 'job_delivered', jobCode },
      },
      actorId,
    );
  }

  // ── Events (polymorphic timeline) ─────────────────────────────────────────

  // Paginated, newest-first events for a job. TECHs are scoped to their own jobs.
  async listEvents(code: string, user: AuthUser, dto: ListEventsDto) {
    const job = await this.resolveJob(code, user.workshopId);
    assertJobAccess(job, user);
    return this.events.listEvents(job.id, { cursor: dto.cursor, limit: dto.limit });
  }

  // Create a client-originated event, persist + broadcast it, return it (with
  // `clientId` echoed for optimistic reconciliation). Role rules are
  // type-conditional, so they live here rather than on @Roles():
  //   • SYSTEM / STATUS_CHANGE / PART_ADDED are server-generated only.
  //   • APPROVAL requires manager/admin.
  //   • COMMENT / PHOTO are allowed for any job participant.
  async createEvent(code: string, user: AuthUser, dto: CreateEventDto) {
    const job = await this.resolveJob(code, user.workshopId);
    assertJobAccess(job, user);

    const serverOnly: JobEventType[] = [
      JobEventType.SYSTEM,
      JobEventType.STATUS_CHANGE,
      JobEventType.PART_ADDED,
    ];
    if (serverOnly.includes(dto.type)) {
      throw new ForbiddenException(`${dto.type} events are generated by the server`);
    }
    if (dto.type === JobEventType.APPROVAL && user.role === UserRole.TECH) {
      throw new ForbiddenException('Only managers and admins can post approval events');
    }

    const event = await this.events.emit(job.id, {
      type: dto.type,
      authorId: user.id,
      body: dto.body,
      payload: dto.payload as Prisma.InputJsonValue | undefined,
      clientId: dto.clientId,
    });

    // Ping the other participants on a real message. Fire-and-forget so send
    // latency isn't tied to Expo's push endpoint.
    if (
      dto.type === JobEventType.COMMENT ||
      dto.type === JobEventType.PHOTO ||
      dto.type === JobEventType.VOICE
    ) {
      const author = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { name: true },
      });
      void this.notifyNewMessage(job.id, job.code, dto.type, user.id, author?.name ?? 'Someone');
    }

    return event;
  }

  // A presigned upload for this job's photos: the client PUTs the file straight
  // to storage, then POSTs a PHOTO event carrying the returned fileUrl.
  async presignUpload(code: string, user: AuthUser, contentType?: string) {
    const job = await this.resolveJob(code, user.workshopId);
    assertJobAccess(job, user);
    if (!contentType) throw new BadRequestException('contentType is required');
    return this.storage.createPresignedUpload(contentType, `jobs/${job.id}`);
  }

  // Notify a job's tech + all managers/admins (minus the author) of a new chat
  // message, deep-linking them to the job.
  private async notifyNewMessage(
    jobId: string,
    jobCode: string,
    type: JobEventType,
    authorId: string,
    authorName: string,
  ): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { vehicle: true },
    });
    if (!job) return;

    const preview =
      type === JobEventType.PHOTO
        ? '📷 Photo'
        : type === JobEventType.VOICE
          ? '🎤 Voice note'
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
    await this.notifications.pushToRoles(
      [UserRole.MANAGER, UserRole.ADMIN],
      job.workshopId,
      payload,
      authorId,
    );
  }

  // ── Parts (PART_ADDED events + stock decrement) ───────────────────────────

  async addParts(code: string, items: PartLineDto[], user: AuthUser) {
    const job = await this.resolveJob(code, user.workshopId);
    assertJobAccess(job, user);
    const created: Awaited<ReturnType<JobEventsService['emit']>>[] = [];
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
      const event = await this.events.emit(job.id, {
        type: JobEventType.PART_ADDED,
        authorId: user.id,
        // unit price in paise; the serializer exposes qty × price in rupees.
        payload: { partName: cat.name, qty: item.qty, pricePaise: cat.pricePaise },
      });
      created.push(event);
    }
    return created;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async resolveJob(code: string, workshopId: string) {
    const job = await this.prisma.job.findFirst({ where: { code, workshopId } });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  private async resolveCustomerId(dto: CreateJobDto, workshopId: string): Promise<string> {
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, workshopId },
      });
      if (!customer) throw new NotFoundException('Customer not found');
      return customer.id;
    }
    if (dto.customerName) {
      const count = await this.prisma.customer.count({ where: { workshopId } });
      const customer = await this.prisma.customer.create({
        data: {
          workshopId,
          name: dto.customerName,
          initials: initialsOf(dto.customerName),
          color: ['a', 'b', 'c', 'd', 'e', 'f'][count % 6],
          phone: dto.customerPhone?.trim() || undefined,
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
