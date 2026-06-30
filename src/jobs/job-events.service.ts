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
// keyset (cursor) pagination, newest-first, so the client can scroll upward.
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

  // Newest-first keyset page over (createdAt, id). `take: limit + 1` peeks at
  // the next row to decide whether there's another page.
  async listEvents(jobId: string, opts: { cursor?: string; limit: number }) {
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : undefined;
    const rows = await this.prisma.jobCardEvent.findMany({
      where: {
        jobId,
        ...(decoded
          ? {
              OR: [
                { createdAt: { lt: decoded.createdAt } },
                { createdAt: decoded.createdAt, id: { lt: decoded.id } },
              ],
            }
          : {}),
      },
      include: eventInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
    });

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(serializeEvent),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }
}

// Opaque base64 cursor of `createdAtISO|id`.
const encodeCursor = (createdAt: Date, id: string): string =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64');

const decodeCursor = (cursor: string): { createdAt: Date; id: string } | undefined => {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64').toString('utf8').split('|');
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
};
