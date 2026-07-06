import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { serializeUser, serializeWorkshop } from '../common/serializers';
import { AccessTokenPayload } from './jwt.strategy';
import { LoginDto } from './dto/login.dto';

type Tokens = { accessToken: string; refreshToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // ── Public flows ───────────────────────────────────────────────────────────

  /** Token-based login (email or phone). Returns the user + tokens. */
  async login(dto: LoginDto) {
    const user = await this.findByIdentifier(dto.email);
    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const tokens = await this.issueTokens(user, user.workshopId);
    await this.storeRefreshHash(user.id, tokens.refreshToken);
    return { user: serializeUser(user), tokens };
  }

  // Resolve "email or phone". Phones match on their last 10 digits, so
  // "+91 98200 11223", "98200 11223" and "9820011223" all find the same user
  // regardless of how the number was stored. Staff lists are tiny, so the
  // in-memory scan is fine.
  private async findByIdentifier(identifier: string) {
    const id = identifier.trim();
    if (id.includes('@')) {
      return this.prisma.user.findUnique({ where: { email: id.toLowerCase() } });
    }
    const digits = id.replace(/\D/g, '').slice(-10);
    if (digits.length < 7) return null;
    const users = await this.prisma.user.findMany({ where: { phone: { not: null } } });
    return users.find((u) => u.phone!.replace(/\D/g, '').endsWith(digits)) ?? null;
  }

  /** Rotating refresh: verify, match the stored hash, issue a fresh pair. */
  async refresh(refreshToken: string) {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active || !user.refreshTokenHash) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const matches = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    // Preserve whichever workshop the session was switched into — refreshing
    // must not silently bounce the user back to their home workshop. If access
    // to it was revoked since, fall back home rather than fail the refresh.
    const workshopId =
      payload.workshopId && (await this.hasWorkshopAccess(user, payload.workshopId))
        ? payload.workshopId
        : user.workshopId;
    const tokens = await this.issueTokens(user, workshopId);
    await this.storeRefreshHash(user.id, tokens.refreshToken);
    return { tokens };
  }

  /**
   * Switch the caller's session into another workshop they have access to
   * (their home workshop, or one granted via WorkshopAccess). Mints a fresh
   * token pair scoped to it — every subsequent request is re-scoped from the
   * next call onward.
   */
  async switchWorkshop(userId: string, workshopId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const workshop = await this.prisma.workshop.findUnique({ where: { id: workshopId } });
    if (!workshop) throw new NotFoundException('Workshop not found');
    if (!(await this.hasWorkshopAccess(user, workshopId))) {
      throw new ForbiddenException('You do not have access to this workshop');
    }
    const tokens = await this.issueTokens(user, workshopId);
    await this.storeRefreshHash(user.id, tokens.refreshToken);
    return { workshop: serializeWorkshop(workshop, true), tokens };
  }

  private async hasWorkshopAccess(user: User, workshopId: string): Promise<boolean> {
    if (user.workshopId === workshopId) return true;
    const grant = await this.prisma.workshopAccess.findUnique({
      where: { userId_workshopId: { userId: user.id, workshopId } },
    });
    return grant !== null;
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return serializeUser(user);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async issueTokens(user: User, workshopId: string): Promise<Tokens> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      workshopId,
    };
    // expiresIn comes from env (a string like "15m"/"30d"); cast past the `ms`
    // StringValue template type.
    const accessTtl = (process.env.JWT_ACCESS_TTL ?? '15m') as unknown as number;
    // Long refresh window: sessions persist until the user explicitly logs out
    // (the token also rotates on every refresh, extending it for active users).
    const refreshTtl = (process.env.JWT_REFRESH_TTL ?? '365d') as unknown as number;
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: accessTtl,
      }),
      this.jwt.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: refreshTtl,
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private async storeRefreshHash(userId: string, refreshToken: string): Promise<void> {
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { refreshTokenHash } });
  }
}
