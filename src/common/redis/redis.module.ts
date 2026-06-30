import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

// Injection token for the shared ioredis client.
export const REDIS_CLIENT = 'REDIS_CLIENT';

// Global so any module can inject the Redis client without importing this
// module (mirrors StorageModule/PrismaModule). The socket.io gateway duplicates
// this client for its pub/sub redis-adapter; other callers can reuse it as-is.
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () =>
        new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
          // Don't crash the app if Redis is briefly unavailable; ioredis retries.
          maxRetriesPerRequest: null,
          lazyConnect: false,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
