import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
};

// Validates the Bearer access token and hydrates request.user (AuthUser).
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
    });
  }

  validate(payload: AccessTokenPayload): AuthUser {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
