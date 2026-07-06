import { Injectable, Logger } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterTokenDto } from './dto/register-token.dto';

// The data payload rides along with every push; the app reads `type` (+ ids) to
// deep-link the user to the right screen when they tap the notification.
export type PushData = {
  type:
    | 'chat'
    | 'estimate_submitted'
    | 'estimate_approved'
    | 'estimate_declined'
    | 'job_assigned'
    | 'job_completed'
    | 'job_delivered';
  jobCode?: string;
  [key: string]: unknown;
};

export type PushPayload = {
  title: string;
  body: string;
  data?: PushData;
};

// Expo's push endpoint accepts up to 100 messages per request.
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

type ExpoTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Token registry ─────────────────────────────────────────────────────────

  /**
   * Register (or re-point) one device's Expo push token to the current user.
   * Tokens are globally unique: if the same device previously belonged to a
   * different user, the upsert moves it to whoever is logged in now.
   */
  async register(userId: string, dto: RegisterTokenDto) {
    await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: { userId, token: dto.token, platform: dto.platform },
      update: { userId, platform: dto.platform },
    });
    return { message: 'Device registered for push notifications' };
  }

  /** Drop a device token (called on logout / when a token is rejected). */
  async unregister(token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token } });
    return { message: 'Device unregistered' };
  }

  // ── Sending ──────────────────────────────────────────────────────────────

  /** Push to every registered device, regardless of user. Returns the targeted
   *  tokens and Expo's raw tickets so the public test route can show why a push
   *  did or didn't arrive. */
  async pushToAll(
    payload: PushPayload,
  ): Promise<{ tokens: string[]; tickets: ExpoTicket[] }> {
    const devices = await this.prisma.deviceToken.findMany({
      select: { token: true },
    });
    const tokens = devices.map((d) => d.token);
    const tickets: ExpoTicket[] = [];
    for (const token of tokens) {
      tickets.push(...(await this.sendTest(token, payload)));
    }
    return { tokens, tickets };
  }

  /** Push to every device of the given users (deduped, self-excluded by caller).
   *  Every recipient also gets an inbox row, so users without a registered
   *  device (or who missed the push) can still find the notification in-app. */
  async pushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length === 0) return;
    try {
      await this.prisma.notification.createMany({
        data: ids.map((userId) => ({
          userId,
          title: payload.title,
          body: payload.body,
          data: (payload.data as Prisma.InputJsonValue) ?? undefined,
        })),
      });
    } catch (err) {
      // The inbox is best-effort, like the push itself.
      this.logger.error(`Failed to persist notifications: ${String(err)}`);
    }
    const devices = await this.prisma.deviceToken.findMany({
      where: { userId: { in: ids } },
      select: { token: true },
    });
    await this.sendToTokens(
      devices.map((d) => d.token),
      payload,
    );
  }

  // ── Inbox ──────────────────────────────────────────────────────────────────

  /** The current user's inbox, newest first, plus their unread count. */
  async inbox(userId: string) {
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      items: rows.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        data: (n.data ?? undefined) as PushData | undefined,
        atISO: n.createdAt.toISOString(),
        read: n.readAt !== null,
      })),
      unread,
    };
  }

  /** Mark the current user's whole inbox as read. */
  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { message: 'Notifications marked read' };
  }

  /**
   * Push to every active user holding one of `roles`, optionally excluding the
   * actor who triggered the event (so a manager submitting doesn't ping
   * themselves).
   */
  async pushToRoles(
    roles: UserRole[],
    payload: PushPayload,
    excludeUserId?: string,
  ): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { role: { in: roles }, active: true, id: { not: excludeUserId } },
      select: { id: true },
    });
    await this.pushToUsers(
      users.map((u) => u.id),
      payload,
    );
  }

  /**
   * Fire a single push to one explicit Expo token and return Expo's raw
   * tickets, so a tester can see whether the message was accepted. Unlike the
   * fire-and-forget paths above, this surfaces errors instead of swallowing
   * them — it exists purely for the public /notifications/test route.
   */
  async sendTest(token: string, payload: PushPayload): Promise<ExpoTicket[]> {
    const message = {
      to: token,
      sound: 'notification.wav',
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      priority: 'high',
      channelId: 'default',
    };
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify([message]),
    });
    const json = (await res.json()) as { data?: ExpoTicket[] };
    const tickets = json.data ?? [];
    await this.handleTickets([token], tickets);
    return tickets;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async sendToTokens(tokens: string[], payload: PushPayload): Promise<void> {
    const unique = [...new Set(tokens)];
    if (unique.length === 0) return;

    for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
      const chunk = unique.slice(i, i + CHUNK_SIZE);
      const messages = chunk.map((to) => ({
        to,
        sound: 'notification.wav',
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        priority: 'high',
        channelId: 'default',
      }));

      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messages),
        });
        if (!res.ok) {
          this.logger.warn(`Expo push HTTP ${res.status}: ${await res.text()}`);
          continue;
        }
        const json = (await res.json()) as { data?: ExpoTicket[] };
        await this.handleTickets(chunk, json.data ?? []);
      } catch (err) {
        // Never let a push failure break the originating request (chat, approval…).
        this.logger.error(`Failed to send push chunk: ${String(err)}`);
      }
    }
  }

  // Prune tokens Expo reports as no longer valid (app uninstalled / token churn).
  private async handleTickets(tokens: string[], tickets: ExpoTicket[]): Promise<void> {
    const dead: string[] = [];
    tickets.forEach((ticket, idx) => {
      if (ticket.status === 'error') {
        this.logger.warn(`Push ticket error for ${tokens[idx]}: ${ticket.message}`);
        if (ticket.details?.error === 'DeviceNotRegistered') dead.push(tokens[idx]);
      }
    });
    if (dead.length) {
      await this.prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
    }
  }
}
