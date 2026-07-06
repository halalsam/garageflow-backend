import { UserRole } from '@prisma/client';

// The single source of truth for verifying access tokens. Both the HTTP
// passport strategy (jwt.strategy.ts) and the socket.io gateway handshake read
// this so they can never drift on secret or payload shape.
export const ACCESS_TOKEN_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me';

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
  workshopId: string;
};
