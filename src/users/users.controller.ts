import { Body, Controller, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';

// Team management: admins manage everyone; managers can view the whole team
// and add technicians (so they can staff jobs without an admin).
@ApiTags('team')
@ApiBearerAuth('access-token')
@Controller('team')
@Roles(UserRole.ADMIN, UserRole.MANAGER)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser('workshopId') workshopId: string) {
    return this.users.list(workshopId);
  }

  @Post()
  create(@Body() dto: CreateTeamMemberDto, @CurrentUser() user: AuthUser) {
    if (user.role === UserRole.MANAGER && dto.role !== 'tech') {
      throw new ForbiddenException('Managers can only add technicians');
    }
    return this.users.create(dto, user.workshopId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTeamMemberDto,
    @CurrentUser('workshopId') workshopId: string,
  ) {
    return this.users.update(id, dto, workshopId);
  }
}
