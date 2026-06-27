# GarageFlow API — single-stage image for a free-tier demo deploy.
# Keeps the Prisma CLI + ts-node available so the container can run
# `migrate deploy` and seed at startup (see render.yaml preDeployCommand /
# the start command below).
FROM node:22-slim

# OpenSSL is needed by Prisma's query engine.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install ALL deps (incl. dev) — we need nest-cli, prisma, ts-node, typescript
# for the build + migrate/seed steps.
COPY package*.json ./
RUN npm ci

# Generate the Prisma client, then build the Nest app.
COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
# Render injects PORT; default to 3000 for local `docker run`.
ENV PORT=3000
EXPOSE 3000

# Apply migrations, then boot. (Seeding is done once via Render's
# preDeployCommand so it doesn't re-run on every restart — but it's safe to
# re-run because seed.ts clears tables first.)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
