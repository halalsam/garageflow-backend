import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ACCESS_TOKEN_SECRET, AccessTokenPayload } from './access-token';

export type { AccessTokenPayload };

// Validates the Bearer access token and hydrates request.user (AuthUser).
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: ACCESS_TOKEN_SECRET,
    });
  }

  validate(payload: AccessTokenPayload): AuthUser {
    // Pre-multi-tenancy tokens carry no workshopId; without it scoped queries
    // would silently pass `workshopId: undefined` (i.e. no filter). Force a
    // refresh — /auth/refresh re-mints from the DB row, which has it.
    if (!payload.workshopId) throw new UnauthorizedException('Token predates workshop scoping');
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      workshopId: payload.workshopId,
    };
  }
}
