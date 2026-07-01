import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateJobDto {
  @IsOptional()
  @IsIn([
    'IN PROGRESS',
    'IN_PROGRESS',
    'AWAITING PART',
    'AWAITING_PART',
    'REVIEW',
    'COMPLETED',
    'DELIVERED',
  ])
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @IsOptional()
  @IsString()
  techId?: string;

  @IsOptional()
  @IsString()
  bay?: string;

  @IsOptional()
  @IsIn(['HIGH', 'NORMAL'])
  priority?: string;

  // Hand-off note recorded when the vehicle is marked DELIVERED. At least one of
  // the two must be present (enforced in the service).
  @IsOptional()
  @IsString()
  deliveryNote?: string;

  @IsOptional()
  @IsString()
  deliveryNoteAudioUrl?: string;
}
