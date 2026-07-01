import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  // Email or phone number; kept named `email` for wire compatibility.
  @IsString()
  @MinLength(3, { message: 'Email or phone number is required' })
  email: string;

  @IsString()
  @MinLength(1, { message: 'Password is required' })
  password: string;
}
