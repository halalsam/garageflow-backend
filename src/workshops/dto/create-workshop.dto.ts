import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateWorkshopDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  // Create-and-switch in one step when true.
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  gstRate?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  invoicePrefix?: string;

  @IsOptional()
  @IsString()
  invoiceFooter?: string;
}
