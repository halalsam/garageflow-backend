import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsIn(['tech', 'manager', 'admin'])
  role?: 'tech' | 'manager' | 'admin';

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
