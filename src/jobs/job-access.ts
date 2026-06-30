import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../common/decorators/current-user.decorator';

// A technician may only touch jobs assigned to them; managers/admins see all.
// Mirrors the scoping in JobsService.list(). Pure so the HTTP service and the
// socket gateway share one rule. Throws ForbiddenException on no access.
export function assertJobAccess(job: { techId: string | null }, user: AuthUser): void {
  if (user.role === UserRole.TECH && job.techId !== user.id) {
    throw new ForbiddenException('You do not have access to this job');
  }
}
