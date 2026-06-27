import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// Multipart: text fields validate here; image/voice files arrive on
// @UploadedFiles(). Numeric fields are @Type-coerced from multipart strings.
export class TimelineEntryDto {
  @IsIn(['text', 'photo', 'voice', 'part', 'system'])
  kind: 'text' | 'photo' | 'voice' | 'part' | 'system';

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationMs?: number;

  @IsOptional()
  @IsString()
  partName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  qty?: number;

  // Rupees (PART entries).
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsIn(['purple', 'green'])
  systemTone?: 'purple' | 'green';

  @IsOptional()
  @IsString()
  systemIcon?: string;
}
