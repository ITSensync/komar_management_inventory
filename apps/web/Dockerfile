FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
ARG INTERNAL_API_BASE_URL=http://api:3000
ENV INTERNAL_API_BASE_URL=$INTERNAL_API_BASE_URL
ARG NEXT_PUBLIC_RFID_WS_URL=ws://localhost:3000/ws
ENV NEXT_PUBLIC_RFID_WS_URL=$NEXT_PUBLIC_RFID_WS_URL
ARG NEXT_PUBLIC_RFID_PO_READER_CODE=orangepi-reader-01
ENV NEXT_PUBLIC_RFID_PO_READER_CODE=$NEXT_PUBLIC_RFID_PO_READER_CODE
ARG NEXT_PUBLIC_RFID_TERMINAL_READER_CODE=orangepi-reader-02
ENV NEXT_PUBLIC_RFID_TERMINAL_READER_CODE=$NEXT_PUBLIC_RFID_TERMINAL_READER_CODE
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3001
CMD ["node", "server.js"]
