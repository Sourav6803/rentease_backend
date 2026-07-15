FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY ecosystem.config.js ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Production stage
FROM node:18-alpine

RUN apk add --no-cache tini

WORKDIR /app

# Create node user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

# Create required directories
RUN mkdir -p logs uploads && \
    chown -R nodejs:nodejs logs uploads

USER nodejs

EXPOSE 5000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/app.js"]