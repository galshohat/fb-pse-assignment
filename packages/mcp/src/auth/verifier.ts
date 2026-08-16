import { OAuthError, OAuthErrorCode, type AuthInfo } from '@modelcontextprotocol/server';
import { scopesForRole, type Role } from './scopes.js';
import type { CredentialStore } from './store.js';

/** Prefixes make a credential recognisable in a log or a support ticket. */
export const API_KEY_PREFIX = 'todo_key';
export const ACCESS_TOKEN_PREFIX = 'todo_at';

/** An OAuth access token held in memory for its short life. */
export interface AccessTokenRecord {
  readonly clientId: string;
  readonly subject: string;
  readonly role: Role;
  readonly expiresAt: number;
  /** RFC 8707 resource the token was minted for, when the client named one. */
  readonly resource?: string;
}

/**
 * Live OAuth access tokens.
 *
 * Deliberately not persisted: they expire in minutes, so a restart simply
 * makes clients refresh, which they do transparently. Refresh tokens, which
 * must survive a restart, are stored hashed on disk instead.
 */
export class AccessTokenRegistry {
  private readonly tokens = new Map<string, AccessTokenRecord>();

  issue(token: string, record: AccessTokenRecord): void {
    // Expired tokens are dropped on lookup, but a token never presented again
    // would otherwise sit here for the life of the process. Sweeping on issue
    // bounds the map by the number of *live* tokens without needing a timer.
    const now = Date.now();
    for (const [existing, held] of this.tokens) {
      if (held.expiresAt <= now) this.tokens.delete(existing);
    }

    this.tokens.set(token, record);
  }

  /** Removes one token immediately, whatever its remaining lifetime. */
  revoke(token: string): boolean {
    return this.tokens.delete(token);
  }

  get(token: string): AccessTokenRecord | undefined {
    const record = this.tokens.get(token);
    if (!record) return undefined;

    if (record.expiresAt <= Date.now()) {
      this.tokens.delete(token);
      return undefined;
    }

    return record;
  }

  revokeAllForSubject(subject: string): void {
    for (const [token, record] of this.tokens) {
      if (record.subject === subject) this.tokens.delete(token);
    }
  }
}

/**
 * The single point where a credential becomes an identity.
 *
 * Both supported credential types — OAuth access tokens and long-lived API
 * keys — resolve to the same AuthInfo, so every authorization decision after
 * this point is a scope check and nothing downstream needs to know which kind
 * of credential the caller used. Adding a third source, such as a corporate
 * identity provider, means writing another branch here and changing nothing
 * else.
 */
export class CredentialVerifier {
  /**
   * @param expectedResource The canonical identity of this resource server —
   *   the public URL clients connect to. A token minted for a different
   *   resource is refused here (RFC 8707), so a token issued by this
   *   authorization server for some other service cannot be replayed against
   *   this one.
   */
  constructor(
    private readonly store: CredentialStore,
    private readonly accessTokens: AccessTokenRegistry,
    private readonly expectedResource: string,
  ) {}

  verifyAccessToken = async (token: string): Promise<AuthInfo> => {
    return token.startsWith(`${API_KEY_PREFIX}_`)
      ? this.verifyApiKey(token)
      : this.verifyOAuthToken(token);
  };

  private verifyApiKey(token: string): AuthInfo {
    const record = this.store.findApiKeyBySecret(token);

    // One message for every rejection: a caller must not be able to tell an
    // unknown key from a revoked or expired one by the error they get back.
    if (!record || record.revokedAt) throw invalidToken();

    const expiresAt = new Date(record.expiresAt);
    if (expiresAt <= new Date()) throw invalidToken();

    return {
      token,
      clientId: record.id,
      scopes: scopesForRole(record.role),
      // requireBearerAuth rejects a token without an expiry, which is the
      // behaviour we want: every credential in this system ages out.
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
      extra: { role: record.role, label: record.label, credential: 'api-key' },
    };
  }

  private verifyOAuthToken(token: string): AuthInfo {
    const record = this.accessTokens.get(token);
    if (!record) throw invalidToken();

    // Audience check. A token that names a resource must name *this* one; a
    // token without a resource binding was not minted for anything else, so it
    // passes. Comparison is on parsed URLs, so a trailing slash cannot split
    // one identity into two.
    if (record.resource !== undefined && !sameResource(record.resource, this.expectedResource)) {
      throw invalidToken();
    }

    return {
      token,
      clientId: record.clientId,
      scopes: scopesForRole(record.role),
      expiresAt: Math.floor(record.expiresAt / 1000),
      extra: { role: record.role, subject: record.subject, credential: 'oauth' },
    };
  }
}

function sameResource(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

function invalidToken(): OAuthError {
  return new OAuthError(
    OAuthErrorCode.InvalidToken,
    'The credential is missing, expired, revoked or not recognised',
  );
}
