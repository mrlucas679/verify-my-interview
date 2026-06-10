# syntax=docker/dockerfile:1

# --- Build stage -------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Backend deps (incl. dev) for the TypeScript build
COPY package.json package-lock.json* ./
RUN npm ci

# Sources for backend + frontend
COPY tsconfig.json ./
COPY src ./src
COPY frontend ./frontend

# Builds backend (tsc -> dist, copies JSON data) AND frontend (vite -> public)
RUN npm run build

# --- Runtime stage -----------------------------------------------------------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled backend + built web UI (both produced in the build stage)
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# Container Apps / App Service inject PORT; the server reads process.env.PORT
EXPOSE 3000
CMD ["node", "dist/src/backend/server.js"]
