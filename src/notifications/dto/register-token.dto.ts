import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class RegisterTokenDto {
  // Expo push tokens look like "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]".
  @IsString()
  @Matches(/^ExponentPushToken\[.+\]$/, {
    message: 'token must be a valid Expo push token',
  })
  token!: string;

  @IsOptional()
  @IsIn(['ios', 'android'])
  platform?: 'ios' | 'android';
}
