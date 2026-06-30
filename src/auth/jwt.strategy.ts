import { Injectable } from '@nestjs/common';
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
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
