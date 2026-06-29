import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Logs one line per HTTP request: `METHOD url → status (Xms)`.
 *
 * Runs as middleware (before guards), and logs on the response `finish` event,
 * so it captures everything — including requests rejected by an auth guard
 * (401/403) that never reach a controller. Level reflects status: 5xx → error,
 * 4xx → warn, else log.
 */
@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl } = req;
    const start = Date.now();

    res.on('finish', () => {
      const ms = Date.now() - start;
      const status = res.statusCode;
      const line = `${method} ${originalUrl} → ${status} (${ms}ms)`;
      if (status >= 500) this.logger.error(line);
      else if (status >= 400) this.logger.warn(line);
      else this.logger.log(line);
    });

    next();
  }
}
