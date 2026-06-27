import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCatalogueItemDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  sku: string;

  @IsIn(['part', 'service'])
  kind: 'part' | 'service';

  // Parts only.
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  // Rupees (converted to paise on the way in).
  @IsNumber()
  @Min(0)
  price: number;
}
