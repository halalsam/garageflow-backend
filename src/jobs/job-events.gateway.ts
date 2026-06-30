import { Inject, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
import { ACCESS_TOKEN_SECRET, AccessTokenPayload } from '../auth/access-token';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';
import { assertJobAccess } from './job-access';

// One room per job card.
export const roomFor = (jobId: string) => `job:${jobId}`;

// Socket.io gateway for the real-time timeline. Auth is per-handshake (the
// global HTTP guards don't cover websockets); job access is checked on joinJob
// with the same rule as the REST endpoints. Broadcasts fan out across instances
// via the redis-adapter so a POST on one node reaches clients on another.
@WebSocketGateway({ cors: true })
export class JobEventsGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(JobEventsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  afterInit(server: Server) {
    // Two dedicated connections (pub/sub) for the adapter; never the request client.
    const pub = this.redis.duplicate();
    const sub = this.redis.duplicate();
    server.adapter(createAdapter(pub, sub));
    this.logger.log('Redis adapter attached');
  }

  handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('Missing token');
      const payload = this.jwt.verify<AccessTokenPayload>(token, {
        secret: ACCESS_TOKEN_SECRET,
      });
      const user: AuthUser = { id: payload.sub, email: payload.email, role: payload.role };
      socket.data.user = user;
    } catch {
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('joinJob')
  async joinJob(socket: Socket, code: string) {
    const user = socket.data.user as AuthUser | undefined;
    if (!user) return { ok: false, error: 'unauthenticated' };
    const job = await this.prisma.job.findUnique({
      where: { code },
      select: { id: true, techId: true },
    });
    if (!job) return { ok: false, error: 'not_found' };
    try {
      assertJobAccess(job, user);
    } catch {
      return { ok: false, error: 'forbidden' };
    }
    await socket.join(roomFor(job.id));
    return { ok: true };
  }

  @SubscribeMessage('leaveJob')
  async leaveJob(socket: Socket, code: string) {
    const job = await this.prisma.job.findUnique({
      where: { code },
      select: { id: true },
    });
    if (job) await socket.leave(roomFor(job.id));
    return { ok: true };
  }

  // Emit a serialized event to everyone in the job's room (across instances).
  broadcast(jobId: string, event: unknown) {
    this.server?.to(roomFor(jobId)).emit('event', event);
  }
}
