# ============================================================================
# CEW AI Service - Dockerfile
# ============================================================================
# Build: docker build -t cew-ai-service .
# Run:   docker run -p 3001:3001 --env-file .env cew-ai-service
# ============================================================================

FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create directories for documents and index
RUN mkdir -p /app/documents /app/index-store

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start server
CMD ["node", "dist/server.js"]
