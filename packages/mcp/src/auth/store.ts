import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Role } from './scopes.js';

/**
 * A credential as stored. Only the hash is kept: the credential itself is
 * shown once, when it is issued, and cannot be recovered afterwards.
 */
export interface ApiKeyRecord {
  /** Public identifier used in logs and audit entries. Not a secret. */
  readonly id: string;
  readonly label: string;
  readonly hash: string;
  readonly role: Role;
  readonly createdAt: string;
  readonly expiresAt: string;
  revokedAt?: string;
}

export interface OAuthClientRecord {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly createdAt: string;
}

export interface RefreshTokenRecord {
  readonly hash: string;
  readonly clientId: string;
  readonly subject: string;
  readonly role: Role;
  readonly expiresAt: string;
  /** Rotation marker: a refresh token may be redeemed exactly once. */
  usedAt?: string;
}

interface PersistedState {
  version: 1;
  apiKeys: ApiKeyRecord[];
  oauthClients: OAuthClientRecord[];
  refreshTokens: RefreshTokenRecord[];
}

const EMPTY_STATE: PersistedState = {
  version: 1,
  apiKeys: [],
  oauthClients: [],
  refreshTokens: [],
};

/**
 * Credential storage backed by a single JSON file.
 *
 * A file is the right size of solution for one service on one host, and it
 * keeps the demo dependency-free. It is also the first thing to replace for
 * real deployment: several instances behind a load balancer would need shared
 * storage, and that is noted in the architecture documentation rather than
 * pretended away.
 */
export class CredentialStore {
  private state: PersistedState;
  private loadedMtimeMs = 0;

  constructor(private readonly filePath: string) {
    this.state = this.read();
  }

  static forDataDir(dataDir: string): CredentialStore {
    return new CredentialStore(join(dataDir, 'credentials.json'));
  }

  get apiKeys(): readonly ApiKeyRecord[] {
    this.reloadIfChanged();
    return this.state.apiKeys;
  }

  get oauthClients(): readonly OAuthClientRecord[] {
    this.reloadIfChanged();
    return this.state.oauthClients;
  }

  addApiKey(record: ApiKeyRecord): void {
    this.state.apiKeys.push(record);
    this.write();
  }

  revokeApiKey(id: string): boolean {
    const record = this.state.apiKeys.find((key) => key.id === id && !key.revokedAt);
    if (!record) return false;

    record.revokedAt = new Date().toISOString();
    this.write();
    return true;
  }

  /** Finds a live key by its presented secret, in constant time per candidate. */
  findApiKeyBySecret(secret: string): ApiKeyRecord | undefined {
    this.reloadIfChanged();
    const presented = hashSecret(secret);
    return this.state.apiKeys.find((key) => secretsMatch(key.hash, presented));
  }

  addOAuthClient(record: OAuthClientRecord): void {
    this.state.oauthClients.push(record);
    this.write();
  }

  findOAuthClient(clientId: string): OAuthClientRecord | undefined {
    this.reloadIfChanged();
    return this.state.oauthClients.find((client) => client.clientId === clientId);
  }

  addRefreshToken(record: RefreshTokenRecord): void {
    this.state.refreshTokens.push(record);
    this.write();
  }

  findRefreshToken(secret: string): RefreshTokenRecord | undefined {
    this.reloadIfChanged();
    const presented = hashSecret(secret);
    return this.state.refreshTokens.find((token) => secretsMatch(token.hash, presented));
  }

  /**
   * Marks a refresh token as spent. Refresh tokens rotate, so redeeming one
   * twice means it was replayed — the caller treats that as an error rather
   * than issuing a second set of tokens from it.
   */
  consumeRefreshToken(hash: string): void {
    const record = this.state.refreshTokens.find((token) => token.hash === hash);
    if (record) record.usedAt = new Date().toISOString();
    this.write();
  }

  /** Drops spent and expired refresh tokens so the file does not grow forever. */
  pruneRefreshTokens(now = new Date()): void {
    const before = this.state.refreshTokens.length;
    this.state.refreshTokens = this.state.refreshTokens.filter(
      (token) => !token.usedAt && new Date(token.expiresAt) > now,
    );
    if (this.state.refreshTokens.length !== before) this.write();
  }

  /**
   * Picks up changes written by another process.
   *
   * The credential CLI runs separately from the server, so a key revoked on
   * the command line has to stop working in the already-running server
   * immediately — otherwise revocation is a promise the system does not keep.
   * Comparing the file's modification time makes that a stat call per lookup
   * rather than a full read.
   */
  private reloadIfChanged(): void {
    try {
      const { mtimeMs } = statSync(this.filePath);
      if (mtimeMs !== this.loadedMtimeMs) this.state = this.read();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private read(): PersistedState {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as PersistedState;
      this.loadedMtimeMs = statSync(this.filePath).mtimeMs;
      return { ...EMPTY_STATE, ...parsed };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return structuredClone(EMPTY_STATE);
      }
      throw error;
    }
  }

  /**
   * Writes through a temporary file and renames it into place, so an
   * interrupted write cannot leave a half-written credential file behind.
   * Permissions are owner-only: the contents are hashes, but they are still
   * the record of who may spend gas.
   */
  private write(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(temporary, this.filePath);
    this.loadedMtimeMs = statSync(this.filePath).mtimeMs;
  }
}

/**
 * Credentials are 256 bits of random data, so a plain SHA-256 is the right
 * choice: there is no low-entropy secret to protect against brute force, which
 * is what a slow password hash exists to do.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function generateSecret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

function secretsMatch(stored: string, presented: string): boolean {
  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
