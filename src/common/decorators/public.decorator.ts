import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Bypass the global JwtAuthGuard for this route (e.g. /auth/login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
