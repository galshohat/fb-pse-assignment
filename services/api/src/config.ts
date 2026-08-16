import { ConfigError, loadCoreConfig, type CoreConfig } from '@todo/core';
import { z } from 'zod';

const apiEnvSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export interface ApiConfig {
  readonly port: number;
  /** Exact browser origin allowed to call the API. Never a wildcard. */
  readonly corsOrigin: string;
  readonly core: CoreConfig;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = apiEnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }

  return {
    port: parsed.data.API_PORT,
    corsOrigin: parsed.data.CORS_ORIGIN,
    core: loadCoreConfig(env),
  };
}
