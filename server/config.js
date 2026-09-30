// Environment-driven configuration. No secrets are ever hardcoded (docs/architecture.md §8).
const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const int = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: ${raw}`);
  }
  return parsed;
};

const config = {
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '0.0.0.0',
  port: int('PORT', 3000),
  // When unset, the app runs without a database (template/dev/static-export mode);
  // migrations and data endpoints require it.
  databaseUrl: process.env.DATABASE_URL || null,
  logLevel: process.env.LOG_LEVEL || 'info',
};

export function loadConfig() {
  return { ...config };
}

export { required };
