import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTeamMemberDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsIn(['tech', 'manager', 'admin'])
  role: 'tech' | 'manager' | 'admin';

  // Optional: invited staff get a default password if none is supplied.
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}
