# Stage 1: Install production dependencies only
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# Stage 2: Build the application with all dependencies
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
# Install ALL dependencies (including dev) for building
RUN npm install
COPY . .
RUN npm run build

# Stage 3: Production runtime image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/docker ./docker

# Create uploads directory and set permissions
RUN mkdir -p /app/uploads/certificates && chown -R node:node /app/uploads

EXPOSE 8080
USER node
CMD ["node", "dist/src/server.js"]
