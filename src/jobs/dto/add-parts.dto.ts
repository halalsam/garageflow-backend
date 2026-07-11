import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
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

  // Optional unit-price override (in paise). Honoured only for managers/admins;
  // techs always bill the catalogue price. Lets the office adjust the charge for
  // a specific job without editing the catalogue master.
  @IsOptional()
  @IsInt()
  @Min(0)
  pricePaise?: number;
}

export class AddPartsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PartLineDto)
  items: PartLineDto[];
}
