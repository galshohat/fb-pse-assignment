import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadCoreConfig, type CoreConfig } from '@todo/core';
import { z } from 'zod';

const mcpEnvSchema = z.object({
  MCP_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  MCP_PUBLIC_URL: z.url('must be a valid URL').default('http://localhost:3001'),
  MCP_DATA_DIR: z.string().default('./data'),
  MCP_ACCESS_TOKEN_TTL: z.coerce.number().int().min(60).max(3_600).default(900),
  MCP_REFRESH_TOKEN_TTL: z.coerce.number().int().min(3_600).default(86_400),
});

export interface McpConfig {
  readonly port: number;
  /** Base URL clients reach this server on; also the OAuth resource identifier. */
  readonly publicUrl: string;
  readonly dataDir: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly core: CoreConfig;
}

export function loadMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const parsed = mcpEnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }

  return {
    port: parsed.data.MCP_PORT,
    publicUrl: parsed.data.MCP_PUBLIC_URL.replace(/\/$/, ''),
    dataDir: resolveDataDir(parsed.data.MCP_DATA_DIR),
    accessTokenTtlSeconds: parsed.data.MCP_ACCESS_TOKEN_TTL,
    refreshTokenTtlSeconds: parsed.data.MCP_REFRESH_TOKEN_TTL,
    core: loadCoreConfig(env),
  };
}

/**
 * Resolves a relative data directory against the workspace root rather than
 * the working directory.
 *
 * The server and the credential CLI are started from different places — one
 * through a workspace script, one possibly from the repository root — and if
 * the path moved with the working directory they would read different files.
 * A credential issued by the CLI would then appear not to exist.
 */
function resolveDataDir(configured: string): string {
  return isAbsolute(configured) ? configured : resolve(workspaceRoot(), configured);
}

function workspaceRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));

  // Walk up to the package.json that declares the workspaces. Works the same
  // whether running from src through tsx or from a built dist directory.
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = resolve(directory, 'package.json');

    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8')) as { workspaces?: unknown };
      if (manifest.workspaces) return directory;
    }

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  // Nothing found: fall back to the working directory rather than guessing.
  return process.cwd();
}
