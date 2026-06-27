import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 moved the connection URL out of schema.prisma. The CLI (migrate,
// db seed, studio) reads it from here; the runtime client gets it via the
// pg driver adapter in src/prisma/prisma.service.ts.
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'ts-node --compiler-options {"module":"CommonJS"} prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
