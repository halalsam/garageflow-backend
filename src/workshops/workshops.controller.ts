import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { WorkshopsService } from './workshops.service';
import { AuthService } from '../auth/auth.service';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateWorkshopDto } from './dto/create-workshop.dto';
import { UpdateWorkshopDto } from './dto/update-workshop.dto';

@ApiTags('workshops')
@ApiBearerAuth('access-token')
@Controller()
export class WorkshopsController {
  constructor(
    private readonly workshops: WorkshopsService,
    private readonly auth: AuthService,
  ) {}

  // The workshop the caller's session is currently scoped to — readable by
  // every role (headers, receipts, GST rate).
  @Get('workshop')
  active(@CurrentUser('workshopId') workshopId: string) {
    return this.workshops.getActive(workshopId);
  }

  // Managing workshops is ADMIN-only.
  @Get('workshops')
  @Roles(UserRole.ADMIN)
  list(@CurrentUser() user: AuthUser) {
    return this.workshops.list(user.id, user.workshopId);
  }

  @Post('workshops')
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateWorkshopDto, @CurrentUser() user: AuthUser) {
    return this.workshops.create(dto, user.id);
  }

  @Patch('workshops/:id')
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateWorkshopDto, @CurrentUser() user: AuthUser) {
    return this.workshops.update(id, dto, user.id);
  }

  // Switch the caller's whole session into another workshop they have access
  // to. Mints a fresh token pair scoped to it — the frontend swaps its stored
  // tokens and every subsequent request is re-scoped from there.
  @Post('workshops/:id/switch')
  @Roles(UserRole.ADMIN)
  switch(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.auth.switchWorkshop(user.id, id);
  }

  // Upload (or replace) the workshop logo (multipart `image`).
  @Post('workshops/:id/logo')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  uploadLogo(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: { image?: Array<{ originalname: string; buffer: Buffer }> },
  ) {
    return this.workshops.saveLogo(id, user.id, files?.image?.[0]);
  }
}
