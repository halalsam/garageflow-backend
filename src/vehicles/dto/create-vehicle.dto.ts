import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

const VEHICLE_TYPES = ['HATCHBACK', 'SEDAN', 'SUV', 'MUV', 'OTHER'];

export class CreateVehicleDto {
  @IsString()
  @MinLength(1)
  customerId: string;

  @IsString()
  @MinLength(1)
  plate: string;

  @IsString()
  @MinLength(1)
  make: string;

  @IsString()
  @MinLength(1)
  model: string;

  @IsInt()
  @Min(1900)
  @Max(2100)
  year: number;

  @IsOptional()
  @IsIn(VEHICLE_TYPES)
  type?: string;
}
