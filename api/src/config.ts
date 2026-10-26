const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://trackwise:trackwise@localhost:5432/trackwise',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
  minio: {
    endpoint: env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    accessKey: env.MINIO_ACCESS_KEY ?? 'trackwise',
    secretKey: env.MINIO_SECRET_KEY ?? 'trackwise-secret',
    bucket: env.MINIO_BUCKET ?? 'trackwise-documents',
  },
  aiUrl: env.AI_URL ?? 'http://localhost:8000',
  jwtSecret: env.JWT_SECRET ?? 'dev-secret',
  alertScanIntervalMs: Number(env.ALERT_SCAN_INTERVAL_MS ?? 60000),
  seedDemoData: (env.SEED_DEMO_DATA ?? 'true') === 'true',
};
