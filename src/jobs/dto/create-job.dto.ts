import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class JobLineDto {
  @IsString()
  @MinLength(1)
  label: string;

  @IsString()
  note: string;

  // Rupees.
  @IsNumber()
  @Min(0)
  amount: number;
}

// Create a job card. Provide an existing vehicleId OR enough to create one
// (plate+make+model+year[+type]); an existing customerId OR a customerName.
export class CreateJobDto {
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  plate?: string;

  @IsOptional()
  @IsString()
  make?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsIn(['HATCHBACK', 'SEDAN', 'SUV', 'MUV', 'OTHER'])
  type?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  complaint?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  odometer?: number;

  @IsOptional()
  @IsIn(['HIGH', 'NORMAL'])
  priority?: string;

  // Initial estimate — required. Every job card is submitted for approval on
  // creation (parks the job in REVIEW), so it must carry at least one line.
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one line item' })
  @ValidateNested({ each: true })
  @Type(() => JobLineDto)
  lines: JobLineDto[];
}
