import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { VehiclesService } from './vehicles.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateVehicleDto } from './dto/create-vehicle.dto';

@ApiTags('vehicles')
@ApiBearerAuth('access-token')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  search(
    @CurrentUser('workshopId') workshopId: string,
    @Query('plate') plate?: string,
    @Query('q') q?: string,
  ) {
    return this.vehicles.search(workshopId, plate, q);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser('workshopId') workshopId: string) {
    return this.vehicles.findOne(id, workshopId);
  }

  @Post()
  create(@Body() dto: CreateVehicleDto, @CurrentUser('workshopId') workshopId: string) {
    return this.vehicles.create(dto, workshopId);
  }

  // Upload (or replace) the vehicle photo (multipart `image`).
  @Post(':id/photo')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  addPhoto(
    @Param('id') id: string,
    @CurrentUser('workshopId') workshopId: string,
    @UploadedFiles() files: { image?: Array<{ originalname: string; buffer: Buffer }> },
  ) {
    return this.vehicles.savePhoto(id, workshopId, files?.image?.[0]);
  }
}
