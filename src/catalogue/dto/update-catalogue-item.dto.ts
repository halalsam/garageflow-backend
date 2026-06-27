import { IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateCatalogueItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sku?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  // Rupees.
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;
}
