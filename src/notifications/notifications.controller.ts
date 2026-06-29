import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RegisterTokenDto } from './dto/register-token.dto';
import { UnregisterTokenDto } from './dto/unregister-token.dto';

// Device-token registry for Expo push notifications. Both routes are
// authenticated — a token is always bound to the user that registered it.
@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // Register (or re-point) this device's Expo push token to the current user.
  @Post('register')
  @HttpCode(200)
  register(@CurrentUser('id') userId: string, @Body() dto: RegisterTokenDto) {
    return this.notifications.register(userId, dto);
  }

  // Forget this device's token (called on logout).
  @Post('unregister')
  @HttpCode(200)
  unregister(@Body() dto: UnregisterTokenDto) {
    return this.notifications.unregister(dto.token);
  }

  // Dev helper: fire a test push to all of the current user's devices.
  @Post('test')
  @HttpCode(200)
  async test(@CurrentUser('id') userId: string) {
    await this.notifications.pushToUsers([userId], {
      title: 'GarageFlow test 🔔',
      body: 'Push notifications are working.',
      data: { type: 'chat', jobCode: 'j1' },
    });
    return { message: 'Test notification sent' };
  }
}
