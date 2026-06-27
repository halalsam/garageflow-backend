import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PartLineDto {
  @IsString()
  @MinLength(1)
  catalogueItemId: string;

  @IsInt()
  @Min(1)
  qty: number;
}

export class AddPartsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PartLineDto)
  items: PartLineDto[];
}
