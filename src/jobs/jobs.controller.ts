import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { EstimatesService } from '../estimates/estimates.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsDto } from './dto/list-events.dto';
import { AddPartsDto } from './dto/add-parts.dto';
import { SubmitEstimateDto } from '../estimates/dto/submit-estimate.dto';

@ApiTags('jobs')
@ApiBearerAuth('access-token')
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly estimates: EstimatesService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('mine') mine?: string,
  ) {
    return this.jobs.list(user, status, mine);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jobs.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateJobDto, @CurrentUser() user: AuthUser) {
    return this.jobs.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateJobDto, @CurrentUser() user: AuthUser) {
    return this.jobs.update(id, dto, user);
  }

  // Paginated, newest-first timeline events (cursor pagination).
  @Get(':id/events')
  listEvents(
    @Param('id') id: string,
    @Query() query: ListEventsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.jobs.listEvents(id, user, query);
  }

  // Create an event (JSON). Persists then broadcasts over the socket gateway.
  @Post(':id/events')
  createEvent(
    @Param('id') id: string,
    @Body() dto: CreateEventDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.jobs.createEvent(id, user, dto);
  }

  // Presigned upload for a photo: PUT the file to `uploadUrl`, then POST a PHOTO
  // event whose payload.url is the returned `fileUrl`.
  @Post(':id/uploads/presign')
  presignUpload(
    @Param('id') id: string,
    @Body('contentType') contentType: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.jobs.presignUpload(id, user, contentType);
  }

  // Mark this job's chat as read by the current user (powers read receipts).
  @Post(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobs.markRead(id, user);
  }

  // Upload (or replace) one mandatory completion photo for a job side.
  @Post(':id/completion-photos')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  addCompletionPhoto(
    @Param('id') id: string,
    @Body('side') side: string,
    @UploadedFiles() files: { image?: Array<{ originalname: string; buffer: Buffer }> },
  ) {
    return this.jobs.saveCompletionPhoto(id, side, files?.image?.[0]);
  }

  // Upload (or replace) one mandatory delivery walk-around photo for a job side.
  @Post(':id/delivery-photos')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  addDeliveryPhoto(
    @Param('id') id: string,
    @Body('side') side: string,
    @UploadedFiles() files: { image?: Array<{ originalname: string; buffer: Buffer }> },
  ) {
    return this.jobs.saveDeliveryPhoto(id, side, files?.image?.[0]);
  }

  @Post(':id/parts')
  addParts(@Param('id') id: string, @Body() dto: AddPartsDto, @CurrentUser() user: AuthUser) {
    return this.jobs.addParts(id, dto.items, user);
  }

  // Submit an estimate for this job (sets it to REVIEW). Approval lives in §6.
  @Post(':id/estimate')
  submitEstimate(
    @Param('id') id: string,
    @Body() dto: SubmitEstimateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.estimates.submit(id, dto, user);
  }
}
