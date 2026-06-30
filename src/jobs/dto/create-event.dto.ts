import { JobEventType } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';

// JSON body (no multipart): photos arrive as a presigned `payload.url`, never as
// a file on this endpoint. `clientId` is the sender's optimistic id, echoed back
// for reconciliation. Type-conditional authorization (APPROVAL → manager/admin,
// SYSTEM → server-only) is enforced in JobsService.createEvent, not here.
export class CreateEventDto {
  @IsEnum(JobEventType)
  type: JobEventType;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  clientId?: string;
}
