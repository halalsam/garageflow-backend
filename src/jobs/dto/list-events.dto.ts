import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Keyset (cursor) pagination over a job's events, newest-first. `cursor` is the
// opaque base64 token returned as `nextCursor`; absent on the first page.
export class ListEventsDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 30;
}
