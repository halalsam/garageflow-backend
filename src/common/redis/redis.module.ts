import { Global, Logger, Module } from '@nestjs/common';
import Redis from 'ioredis';

// Injection token for the shared ioredis client.
export const REDIS_CLIENT = 'REDIS_CLIENT';

// Attach an 'error' listener so a transient connection drop (or a misconfigured
// REDIS_URL) is logged instead of surfacing as an "Unhandled error event" that
// can take the process down. Reused by the gateway's duplicated pub/sub clients.
export const attachRedisErrorLogger = (client: Redis, label: string): Redis => {
  const logger = new Logger(`Redis:${label}`);
  client.on('error', (err: Error) => logger.error(err.message));
  return client;
};

// Global so any module can inject the Redis client without importing this
// module (mirrors StorageModule/PrismaModule). The socket.io gateway duplicates
// this client for its pub/sub redis-adapter; other callers can reuse it as-is.
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () =>
        attachRedisErrorLogger(
          new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
            // Don't crash the app if Redis is briefly unavailable; ioredis retries.
            maxRetriesPerRequest: null,
            lazyConnect: false,
          }),
          'client',
        ),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
