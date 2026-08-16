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
  /** Carried through rotation so refreshed access tokens keep their audience. */
  readonly resource?: string;
  /** Rotation marker: a refresh token may be redeemed exactly once. */
  usedAt?: string;
}

interface PersistedState {
  version: 1;
  apiKeys: ApiKeyRecord[];
  oauthClients: OAuthClientRecord[];
  refreshTokens: RefreshTokenRecord[];
}

/** See addOAuthClient. Far above any legitimate population for one service. */
const MAX_OAUTH_CLIENTS = 200;

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
  /** Identifies the exact file contents currently held in `state`. */
  private loadedStamp = '';

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
    this.reloadIfChanged();
    this.state.apiKeys.push(record);
    this.write();
  }

  revokeApiKey(id: string): boolean {
    this.reloadIfChanged();
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
    this.reloadIfChanged();
    this.state.oauthClients.push(record);

    // Registration is unauthenticated by design (RFC 7591 dynamic client
    // registration), which makes it a way to grow this file without bound.
    // Oldest-first eviction caps that: a legitimate client whose registration
    // is evicted simply registers again on its next connection.
    if (this.state.oauthClients.length > MAX_OAUTH_CLIENTS) {
      this.state.oauthClients = this.state.oauthClients.slice(-MAX_OAUTH_CLIENTS);
    }

    this.write();
  }

  findOAuthClient(clientId: string): OAuthClientRecord | undefined {
    this.reloadIfChanged();
    return this.state.oauthClients.find((client) => client.clientId === clientId);
  }

  addRefreshToken(record: RefreshTokenRecord): void {
    this.reloadIfChanged();
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
    this.reloadIfChanged();
    const record = this.state.refreshTokens.find((token) => token.hash === hash);
    if (record) record.usedAt = new Date().toISOString();
    this.write();
  }

  /**
   * Burns every live refresh token belonging to a subject.
   *
   * Used when a spent refresh token is presented again: rotation means a
   * replay proves the token was stolen at some point, and the honest response
   * is to end the whole session — successor tokens included — rather than
   * only refusing the copy that happened to arrive second.
   */
  revokeRefreshTokensForSubject(subject: string): number {
    this.reloadIfChanged();
    let revoked = 0;

    for (const token of this.state.refreshTokens) {
      if (token.subject === subject && !token.usedAt) {
        token.usedAt = new Date().toISOString();
        revoked += 1;
      }
    }

    if (revoked > 0) this.write();
    return revoked;
  }

  /**
   * Drops expired refresh tokens so the file does not grow forever.
   *
   * Spent-but-unexpired tokens are deliberately kept: they are how a replay is
   * recognised. Pruning a token the moment it is rotated would make a replayed
   * copy indistinguishable from a token that never existed, and the theft
   * response — ending the whole session — could never trigger. The detection
   * window is therefore the token's own lifetime, and so is the file growth.
   */
  pruneRefreshTokens(now = new Date()): void {
    this.reloadIfChanged();
    const before = this.state.refreshTokens.length;
    this.state.refreshTokens = this.state.refreshTokens.filter(
      (token) => new Date(token.expiresAt) > now,
    );
    if (this.state.refreshTokens.length !== before) this.write();
  }

  /**
   * Picks up changes written by another process.
   *
   * The credential CLI runs separately from the server, so a key revoked on
   * the command line has to stop working in the already-running server
   * immediately — otherwise revocation is a promise the system does not keep.
   * Comparing a stamp of the file makes that a stat call per lookup rather
   * than a full read.
   *
   * Called before writes as well as reads. A write serializes the whole
   * in-memory state, so writing from a stale copy would silently undo whatever
   * the other process did in the meantime — including a revocation.
   *
   * What this does not do is make the read-modify-write atomic; two processes
   * writing in the same instant can still lose one of the changes. Closing that
   * properly means a lock or a shared datastore, which is the documented next
   * step for this store rather than something a stat call can fix.
   */
  private reloadIfChanged(): void {
    try {
      if (this.stamp() !== this.loadedStamp) this.state = this.read();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  /**
   * Nanosecond mtime and size together. Millisecond resolution alone is not
   * enough: two writes inside one millisecond share an mtime, and the second
   * would then be invisible.
   */
  private stamp(): string {
    const { mtimeNs, size } = statSync(this.filePath, { bigint: true });
    return `${mtimeNs}:${size}`;
  }

  private read(): PersistedState {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as PersistedState;
      this.loadedStamp = this.stamp();
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
    this.loadedStamp = this.stamp();
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
