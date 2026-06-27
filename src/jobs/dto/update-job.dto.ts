import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateJobDto {
  @IsOptional()
  @IsIn(['IN PROGRESS', 'IN_PROGRESS', 'AWAITING PART', 'AWAITING_PART', 'REVIEW', 'COMPLETED'])
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
}
