import { Injectable } from '@nestjs/common';
import { JobEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { eventInclude, serializeEvent } from '../common/serializers';
import { JobEventsGateway } from './job-events.gateway';

export type EmitEventInput = {
  type: JobEventType;
  authorId?: string | null;
  body?: string;
  payload?: Prisma.InputJsonValue;
  clientId?: string;
};

// The single write+broadcast path for job-card events, reused by JobsService
// (comments/photos/parts/status) and EstimatesService (approval/system). It
// persists the row, serializes it, and fans it out over the gateway. Reads use
// keyset (cursor) pagination over the monotonic `sequenceNumber`, newest-first,
// so the client can scroll upward in a stable order.
@Injectable()
export class JobEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: JobEventsGateway,
  ) {}

  async emit(jobId: string, input: EmitEventInput) {
    const row = await this.prisma.jobCardEvent.create({
      data: {
        jobId,
        authorId: input.authorId ?? null,
        type: input.type,
        body: input.body,
        payload: input.payload,
        clientId: input.clientId,
      },
      include: eventInclude,
    });
    const dto = serializeEvent(row);
    this.gateway.broadcast(jobId, dto);
    return dto;
  }

  // Newest-first keyset page over `sequenceNumber` — a monotonic integer, so
  // unlike (createdAt, id) it can't produce ties or skip/repeat rows.
  // `take: limit + 1` peeks at the next row to decide whether there's another page.
  async listEvents(jobId: string, opts: { cursor?: string; limit: number }) {
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : undefined;
    const rows = await this.prisma.jobCardEvent.findMany({
      where: {
        jobId,
        ...(decoded ? { sequenceNumber: { lt: decoded } } : {}),
      },
      include: eventInclude,
      orderBy: { sequenceNumber: 'desc' },
      take: opts.limit + 1,
    });

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(serializeEvent),
      nextCursor: hasMore && last ? encodeCursor(last.sequenceNumber) : null,
    };
  }
}

// Opaque base64 cursor of the last row's `sequenceNumber`.
const encodeCursor = (sequenceNumber: number): string =>
  Buffer.from(String(sequenceNumber)).toString('base64');

const decodeCursor = (cursor: string): number | undefined => {
  try {
    const n = Number(Buffer.from(cursor, 'base64').toString('utf8'));
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
};
