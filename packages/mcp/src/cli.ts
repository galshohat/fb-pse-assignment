/**
 * Credential management for the MCP server.
 *
 *   npm run keys -w @todo/mcp -- issue --role operator --label "Claude Code"
 *   npm run keys -w @todo/mcp -- list
 *   npm run keys -w @todo/mcp -- revoke <id>
 *
 * A key is shown once, at issue time, and only its hash is stored. Losing it
 * means issuing a new one, which is the point.
 */
import { randomUUID } from 'node:crypto';
import { isRole, ROLE_NAMES, scopesForRole, type Role } from './auth/scopes.js';
import { CredentialStore, generateSecret, hashSecret } from './auth/store.js';
import { API_KEY_PREFIX } from './auth/verifier.js';
import { loadMcpConfig } from './config.js';

const DEFAULT_TTL_DAYS = 30;

function usage(): never {
  console.log(`Usage:
  issue --role <${ROLE_NAMES.join('|')}> [--label <text>] [--days <n>]
  list
  revoke <id>`);
  process.exit(1);
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function issue(store: CredentialStore, args: string[]): void {
  const role = flag(args, 'role') ?? 'viewer';

  if (!isRole(role)) {
    console.error(`Unknown role "${role}". Choose one of: ${ROLE_NAMES.join(', ')}`);
    process.exit(1);
  }

  const days = Number(flag(args, 'days') ?? DEFAULT_TTL_DAYS);
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days must be a positive number');
    process.exit(1);
  }

  const secret = generateSecret(API_KEY_PREFIX);
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  const id = randomUUID().slice(0, 8);

  store.addApiKey({
    id,
    label: flag(args, 'label') ?? `${role} key`,
    hash: hashSecret(secret),
    role: role as Role,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  console.log(`
Issued ${role === 'operator' || role === 'admin' ? 'an' : 'a'} ${role} key.

  id       ${id}
  scopes   ${scopesForRole(role).join(', ')}
  expires  ${expiresAt.toISOString()}

  ${secret}

This is the only time the key is shown. Store it somewhere safe; only its hash
is kept on disk.
`);
}

function list(store: CredentialStore): void {
  if (store.apiKeys.length === 0) {
    console.log('No keys have been issued.');
    return;
  }

  const now = new Date();
  console.log('id        role      status    expires                   label');

  for (const key of store.apiKeys) {
    const status = key.revokedAt
      ? 'revoked'
      : new Date(key.expiresAt) <= now
        ? 'expired'
        : 'active';
    console.log(
      `${key.id.padEnd(9)} ${key.role.padEnd(9)} ${status.padEnd(9)} ${key.expiresAt} ${key.label}`,
    );
  }
}

function revoke(store: CredentialStore, id: string | undefined): void {
  if (!id) usage();

  if (store.revokeApiKey(id)) {
    console.log(`Revoked ${id}. It stops working immediately.`);
  } else {
    console.error(`No active key with id "${id}".`);
    process.exit(1);
  }
}

const [command, ...args] = process.argv.slice(2);
const store = CredentialStore.forDataDir(loadMcpConfig().dataDir);

switch (command) {
  case 'issue':
    issue(store, args);
    break;
  case 'list':
    list(store);
    break;
  case 'revoke':
    revoke(store, args[0]);
    break;
  default:
    usage();
}
