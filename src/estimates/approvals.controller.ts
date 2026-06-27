import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EstimatesService } from './estimates.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { DecisionDto } from './dto/decision.dto';

// Approvals are manager+ (RBAC §6). Estimate *submission* lives on
// POST /jobs/:id/estimate (open to techs).
@ApiTags('approvals')
@ApiBearerAuth('access-token')
@Controller('approvals')
@Roles(UserRole.MANAGER, UserRole.ADMIN)
export class ApprovalsController {
  constructor(private readonly estimates: EstimatesService) {}

  @Get()
  list() {
    return this.estimates.listApprovals();
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.estimates.getApproval(id);
  }

  @Post(':id/decision')
  decide(@Param('id') id: string, @Body() dto: DecisionDto, @CurrentUser() user: AuthUser) {
    return this.estimates.decide(id, dto.decision, user);
  }
}
