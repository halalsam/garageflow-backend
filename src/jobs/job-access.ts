import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../common/decorators/current-user.decorator';

// Jobs are visible only inside their workshop; within it, a technician may
// only touch jobs assigned to them (managers/admins see all). Mirrors the
// scoping in JobsService.list(). Pure so the HTTP service and the socket
// gateway share one rule. Throws ForbiddenException on no access.
export function assertJobAccess(
  job: { techId: string | null; workshopId: string },
  user: AuthUser,
): void {
  if (
    job.workshopId !== user.workshopId ||
    (user.role === UserRole.TECH && job.techId !== user.id)
  ) {
    throw new ForbiddenException('You do not have access to this job');
  }
}
