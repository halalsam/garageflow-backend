import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RegisterTokenDto } from './dto/register-token.dto';
import { UnregisterTokenDto } from './dto/unregister-token.dto';
import { TestPushDto } from './dto/test-push.dto';

// Device-token registry for Expo push notifications. register/unregister are
// authenticated (a token is bound to the user that registered it); the test
// routes are public dev helpers for verifying push delivery.
@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // The current user's inbox (persisted copies of pushes), newest first, plus
  // the unread count for badges.
  @Get()
  inbox(@CurrentUser('id') userId: string) {
    return this.notifications.inbox(userId);
  }

  // Mark the whole inbox read (called when the user opens the inbox screen).
  @Post('read')
  @HttpCode(200)
  markAllRead(@CurrentUser('id') userId: string) {
    return this.notifications.markAllRead(userId);
  }

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

  // Public test helper: broadcast a test push to every registered device.
  // No auth — intended purely for verifying push end-to-end from curl.
  @Public()
  @Post('test')
  @HttpCode(200)
  async test() {
    const { tokens, tickets } = await this.notifications.pushToAll({
      title: 'GarageFlow test 🔔',
      body: 'Push notifications are working.',
      data: { type: 'chat', jobCode: 'j1' },
    });
    return {
      message: 'Test notification sent',
      devices: tokens.length,
      tokens,
      tickets,
    };
  }

  // Public test helper: push to one explicit Expo token without an auth session,
  // and return Expo's tickets so the caller can see whether it was accepted.
  // Handy for verifying push end-to-end straight from a device or curl.
  @Public()
  @Post('test/send')
  @HttpCode(200)
  async testSend(@Body() dto: TestPushDto) {
    const tickets = await this.notifications.sendTest(dto.token, {
      title: dto.title ?? 'GarageFlow test 🔔',
      body: dto.body ?? 'Push notifications are working.',
      data: { type: 'chat', jobCode: 'j1' },
    });
    return { message: 'Test notification sent', tickets };
  }
}
