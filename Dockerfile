# Stage 1: Build the application
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy the source code
COPY . .

WORKDIR /app

# Install server dependencies
RUN pnpm install --frozen-lockfile

# Build the server application
RUN pnpm build

# Start the application
CMD node ./dist/server/entry.mjs