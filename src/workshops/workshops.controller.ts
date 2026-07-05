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
import { Roles } from '../common/decorators/roles.decorator';
import { CreateWorkshopDto } from './dto/create-workshop.dto';
import { UpdateWorkshopDto } from './dto/update-workshop.dto';

@ApiTags('workshops')
@ApiBearerAuth('access-token')
@Controller()
export class WorkshopsController {
  constructor(private readonly workshops: WorkshopsService) {}

  // The active workshop — readable by every role (headers, receipts, GST rate).
  @Get('workshop')
  active() {
    return this.workshops.getActive();
  }

  // Managing workshops is ADMIN-only.
  @Get('workshops')
  @Roles(UserRole.ADMIN)
  list() {
    return this.workshops.list();
  }

  @Post('workshops')
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateWorkshopDto) {
    return this.workshops.create(dto);
  }

  @Patch('workshops/:id')
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateWorkshopDto) {
    return this.workshops.update(id, dto);
  }

  @Post('workshops/:id/activate')
  @Roles(UserRole.ADMIN)
  activate(@Param('id') id: string) {
    return this.workshops.activate(id);
  }

  // Upload (or replace) the workshop logo (multipart `image`).
  @Post('workshops/:id/logo')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  uploadLogo(
    @Param('id') id: string,
    @UploadedFiles() files: { image?: Array<{ originalname: string; buffer: Buffer }> },
  ) {
    return this.workshops.saveLogo(id, files?.image?.[0]);
  }
}
