# =========================================================================
# Stage 1: Build Frontend Client (Vite + React)
# =========================================================================
FROM node:24-alpine AS client-builder
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# =========================================================================
# Stage 2: Production Server Environment
# =========================================================================
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV DB_PATH=/app/data/enterprise_quiz.sqlite

# Install production server dependencies
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci --omit=dev

# Copy server application source
COPY server/ ./

# Copy built frontend assets from client-builder into /app/client/dist
COPY --from=client-builder /app/client/dist /app/client/dist

# Ensure persistent database directory exists and is owned by unprivileged node user
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 4000

CMD ["node", "--import", "tsx", "src/server.ts"]

