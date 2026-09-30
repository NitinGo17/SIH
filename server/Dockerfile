# ManakAI app — Node 20 (docs/architecture.md §3)
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies first for layer caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# Non-root user (alpine image ships it)
USER node

# Apply migrations, then start the app; crash if migrations fail
CMD ["sh", "-c", "node db/migrate.js && exec node index.js"]
