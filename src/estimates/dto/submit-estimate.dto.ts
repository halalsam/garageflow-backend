import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class EstimateLineDto {
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

export class SubmitEstimateDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  gstRate?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EstimateLineDto)
  lines: EstimateLineDto[];
}
