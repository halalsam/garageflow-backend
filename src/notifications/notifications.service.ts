import { Injectable, Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
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
    | 'job_completed';
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

  /** Push to every device of the given users (deduped, self-excluded by caller). */
  async pushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length === 0) return;
    const devices = await this.prisma.deviceToken.findMany({
      where: { userId: { in: ids } },
      select: { token: true },
    });
    await this.sendToTokens(
      devices.map((d) => d.token),
      payload,
    );
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
      sound: 'default',
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
        sound: 'default',
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
