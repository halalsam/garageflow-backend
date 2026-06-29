import { IsOptional, IsString, Matches } from 'class-validator';

// Payload for the public test route: send a push to one explicit Expo token
// without needing an authenticated session.
export class TestPushDto {
  // Expo push tokens look like "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]".
  @IsString()
  @Matches(/^ExponentPushToken\[.+\]$/, {
    message: 'token must be a valid Expo push token',
  })
  token!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;
}
