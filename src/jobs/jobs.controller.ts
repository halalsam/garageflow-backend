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
import { JobsService, UploadedTimelineFiles } from './jobs.service';
import { EstimatesService } from '../estimates/estimates.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { TimelineEntryDto } from './dto/timeline-entry.dto';
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

  @Post(':id/timeline')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'image', maxCount: 1 },
      { name: 'audio', maxCount: 1 },
    ]),
  )
  addTimeline(
    @Param('id') id: string,
    @Body() dto: TimelineEntryDto,
    @UploadedFiles() files: UploadedTimelineFiles,
    @CurrentUser() user: AuthUser,
  ) {
    return this.jobs.addTimeline(id, dto, files ?? {}, user);
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
