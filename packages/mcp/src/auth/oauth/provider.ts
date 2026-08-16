import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { InvalidGrantError } from '@modelcontextprotocol/server-legacy/auth';
import type { AuthInfo, OAuthTokens } from '@modelcontextprotocol/server';
import { ROLES, scopesForRole, type Role } from '../scopes.js';
import { CredentialStore, generateSecret, hashSecret } from '../store.js';
import { ACCESS_TOKEN_PREFIX, AccessTokenRegistry, CredentialVerifier } from '../verifier.js';
import { consentPage, signConsent, type ConsentRequest } from './consent.js';

const REFRESH_TOKEN_PREFIX = 'todo_rt';

/** Authorization codes are single-use and live only long enough to be redeemed. */
const AUTHORIZATION_CODE_TTL_MS = 60_000;

interface PendingAuthorization {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly role: Role;
  readonly subject: string;
  readonly resource?: string;
  readonly expiresAt: number;
}

export interface OAuthProviderOptions {
  readonly store: CredentialStore;
  readonly accessTokens: AccessTokenRegistry;
  readonly verifier: CredentialVerifier;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
}

/** Shape the SDK's authorization handler passes to `authorize`. */
export interface AuthorizationParams {
  readonly state?: string;
  readonly scopes?: string[];
  readonly codeChallenge: string;
  readonly redirectUri: string;
  readonly resource?: URL;
}

/**
 * The authorization-server half of OAuth 2.1 for this service.
 *
 * The SDK owns the protocol surface — endpoint shapes, PKCE verification,
 * metadata documents, error responses — and this class supplies the decisions
 * that are actually ours: who the user is, what role they get, how long a
 * token lives, and when a refresh token is spent.
 *
 * Self-hosting an authorization server is not what a production deployment
 * should do; it exists here so the flow can be demonstrated without an
 * external identity provider. Replacing it with one means implementing
 * verifyAccessToken against that provider and deleting the rest.
 */
export class TodoOAuthProvider {
  private readonly pending = new Map<string, PendingAuthorization>();

  constructor(private readonly options: OAuthProviderOptions) {}

  get clientsStore() {
    return {
      getClient: async (clientId: string) => {
        const client = this.options.store.findOAuthClient(clientId);
        if (!client) return undefined;

        return {
          client_id: client.clientId,
          client_name: client.clientName,
          redirect_uris: [...client.redirectUris],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          scope: Object.values(ROLES).flat().join(' '),
        };
      },

      // Dynamic client registration: MCP clients discover this server and
      // register themselves, which is what lets Claude Code connect without
      // anyone pre-provisioning credentials by hand.
      registerClient: async (client: {
        client_id: string;
        client_name?: string;
        redirect_uris: string[];
      }) => {
        this.options.store.addOAuthClient({
          clientId: client.client_id,
          clientName: client.client_name ?? 'Unnamed client',
          redirectUris: client.redirect_uris,
          createdAt: new Date().toISOString(),
        });

        return {
          ...client,
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        };
      },
    };
  }

  /**
   * Records a consented authorization and returns the code to hand back.
   *
   * Called by the consent route once a human has picked a role, rather than
   * from `authorize` directly: this server has no session, so the decision has
   * to come from an explicit interaction.
   */
  completeAuthorization(input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    role: Role;
    subject: string;
    resource?: string;
  }): string {
    const code = generateSecret('todo_ac');

    this.pending.set(code, {
      ...input,
      expiresAt: Date.now() + AUTHORIZATION_CODE_TTL_MS,
    });

    return code;
  }

  /** Required by the SDK, which verifies the PKCE challenge itself. */
  async challengeForAuthorizationCode(
    _client: { client_id: string },
    authorizationCode: string,
  ): Promise<string> {
    const pending = this.take(authorizationCode, { consume: false });
    return pending.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: { client_id: string },
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const pending = this.take(authorizationCode, { consume: true });

    if (pending.clientId !== client.client_id) {
      throw new InvalidGrantError('This code was issued to a different client');
    }

    if (redirectUri !== undefined && redirectUri !== pending.redirectUri) {
      throw new InvalidGrantError('Redirect URI does not match the one used to authorize');
    }

    return this.issueTokens(pending.clientId, pending.subject, pending.role);
  }

  /**
   * Exchanges a refresh token, rotating it in the process: the presented token
   * is marked spent and a new one is returned. Presenting a spent token means
   * it was replayed, which is refused rather than quietly honoured.
   */
  async exchangeRefreshToken(
    client: { client_id: string },
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const record = this.options.store.findRefreshToken(refreshToken);

    if (!record || record.usedAt) {
      throw new InvalidGrantError('The refresh token is unknown, already used, or revoked');
    }

    if (new Date(record.expiresAt) <= new Date()) {
      throw new InvalidGrantError('The refresh token has expired; sign in again');
    }

    if (record.clientId !== client.client_id) {
      throw new InvalidGrantError('This refresh token was issued to a different client');
    }

    this.options.store.consumeRefreshToken(record.hash);
    return this.issueTokens(record.clientId, record.subject, record.role);
  }

  verifyAccessToken = async (token: string): Promise<AuthInfo> => {
    return this.options.verifier.verifyAccessToken(token);
  };

  async revokeToken(_client: { client_id: string }, request: { token: string }): Promise<void> {
    const record = this.options.store.findRefreshToken(request.token);
    if (record) {
      this.options.store.consumeRefreshToken(record.hash);
      this.options.accessTokens.revokeAllForSubject(record.subject);
    }
  }

  /**
   * The final redirect is issued by the consent POST rather than by this
   * response, so `iss` is appended there by hand. Declaring support here
   * keeps the published metadata truthful.
   */
  readonly authorizationResponseIssParameterSupported = true;

  /**
   * Shows the consent screen.
   *
   * The SDK has already validated the client and the redirect URI by this
   * point. Nothing is issued here: a human has to choose a role and submit
   * the form, which is the whole reason this step is interactive.
   */
  async authorize(
    client: { client_id: string; client_name?: string },
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const request: ConsentRequest = {
      clientId: client.client_id,
      clientName: client.client_name ?? 'An MCP client',
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      ...(params.state !== undefined ? { state: params.state } : {}),
      ...(params.resource !== undefined ? { resource: params.resource.toString() } : {}),
    };

    res.type('html').send(consentPage(request, signConsent(request)));
  }

  private issueTokens(clientId: string, subject: string, role: Role): OAuthTokens {
    const accessToken = generateSecret(ACCESS_TOKEN_PREFIX);
    const refreshToken = generateSecret(REFRESH_TOKEN_PREFIX);
    const { accessTokenTtlSeconds, refreshTokenTtlSeconds } = this.options;

    this.options.accessTokens.issue(accessToken, {
      clientId,
      subject,
      role,
      expiresAt: Date.now() + accessTokenTtlSeconds * 1000,
    });

    this.options.store.addRefreshToken({
      hash: hashSecret(refreshToken),
      clientId,
      subject,
      role,
      expiresAt: new Date(Date.now() + refreshTokenTtlSeconds * 1000).toISOString(),
    });

    this.options.store.pruneRefreshTokens();

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: scopesForRole(role).join(' '),
    };
  }

  private take(code: string, { consume }: { consume: boolean }): PendingAuthorization {
    const pending = this.pending.get(code);

    if (!pending) {
      throw new InvalidGrantError('The authorization code is unknown or has already been used');
    }

    if (pending.expiresAt <= Date.now()) {
      this.pending.delete(code);
      throw new InvalidGrantError('The authorization code has expired');
    }

    if (consume) this.pending.delete(code);
    return pending;
  }
}

/** Kept for symmetry with the SDK's provider interface, which expects it. */
export type ConsentResponder = (res: Response) => void;

export function newSubjectId(): string {
  return `user_${randomUUID().slice(0, 8)}`;
}
