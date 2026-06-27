import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

// Flatten class-validator errors into { field: [messages] } (recursing into
// nested DTOs like estimate/job lines).
function buildFieldErrors(errors: ValidationError[], parent = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const err of errors) {
    const key = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) {
      out[key] = Object.values(err.constraints);
    }
    if (err.children?.length) {
      Object.assign(out, buildFieldErrors(err.children, key));
    }
  }
  return out;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) =>
        new BadRequestException({
          message: 'Validation failed',
          errors: buildFieldErrors(errors),
        }),
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // ── OpenAPI / Swagger ─────────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('GarageFlow API')
    .setDescription(
      'Workshop management API for the GarageFlow mobile app. India-first: ₹ ' +
        '(rupees out, paise in DB), GST, roles tech/manager/admin. Every response ' +
        'matches the mobile contract in `../garageflow/data/mock.ts`.\n\n' +
        '**Auth:** `POST /auth/login` returns `{ user, tokens }`; send ' +
        '`Authorization: Bearer <accessToken>` on every other route. Click ' +
        '**Authorize** and paste the access token to try protected endpoints.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'access-token',
    )
    .addTag('auth', 'Login, token refresh, current user')
    .addTag('jobs', 'Job cards, timeline, parts, estimate submission')
    .addTag('approvals', 'Estimate approvals (manager+) → invoice on approve')
    .addTag('invoices', 'Invoices + payments (manager+); derived paid/balance/status')
    .addTag('finance', 'Derived reports: summary, receivables, collections, GST, profit, ledgers (manager+)')
    .addTag('expenses', 'Expenses (manager+)')
    .addTag('catalogue', 'Parts & services catalogue')
    .addTag('customers', 'Customers (paginated) + vehicles')
    .addTag('vehicles', 'Vehicle plate search')
    .addTag('team', 'Team / user management (admin)')
    .addTag('dashboard', 'Role-aware dashboard metrics')
    .addTag('health', 'Health check')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Persisted spec for the mobile team / client codegen.
  writeFileSync('openapi.json', JSON.stringify(document, null, 2));
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'GarageFlow API Docs',
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`GarageFlow API listening on http://localhost:${port}/api`);
  // eslint-disable-next-line no-console
  console.log(`Swagger docs at        http://localhost:${port}/api/docs`);
}

bootstrap();
