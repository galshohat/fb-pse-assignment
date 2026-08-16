import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { describeMissingScope, hasScope, isRole, SCOPES, scopesForRole } from './scopes.js';
import { TodoOAuthProvider } from './oauth/provider.js';
import { CredentialStore, generateSecret, hashSecret } from './store.js';
import { AccessTokenRegistry, API_KEY_PREFIX, CredentialVerifier } from './verifier.js';

function temporaryStore(): CredentialStore {
  return CredentialStore.forDataDir(mkdtempSync(join(tmpdir(), 'todo-mcp-')));
}

function issueKey(
  store: CredentialStore,
  overrides: Partial<{ role: 'viewer' | 'operator' | 'admin'; expiresAt: string; id: string }> = {},
): string {
  const secret = generateSecret(API_KEY_PREFIX);

  store.addApiKey({
    id: overrides.id ?? 'test-key',
    label: 'test',
    hash: hashSecret(secret),
    role: overrides.role ?? 'operator',
    createdAt: new Date().toISOString(),
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString(),
  });

  return secret;
}

describe('scopes and roles', () => {
  it('grants read but not write to a viewer', () => {
    expect(scopesForRole('viewer')).toEqual([SCOPES.read]);
    expect(hasScope(scopesForRole('viewer'), SCOPES.write)).toBe(false);
  });

  it('grants both to an operator, and admin strictly more', () => {
    expect(hasScope(scopesForRole('operator'), SCOPES.write)).toBe(true);
    expect(scopesForRole('admin')).toEqual(
      expect.arrayContaining([SCOPES.read, SCOPES.write, SCOPES.admin]),
    );
  });

  it('rejects role names that are not roles', () => {
    expect(isRole('operator')).toBe(true);
    expect(isRole('superuser')).toBe(false);
  });

  it.each(['__proto__', 'toString', 'constructor', 'hasOwnProperty'])(
    'does not accept the inherited property %s as a role',
    (candidate) => {
      // A prototype-chain lookup would accept these, and looking up their
      // scopes then throws inside the authorization flow.
      expect(isRole(candidate)).toBe(false);
    },
  );

  it('says what is missing and what the caller holds', () => {
    const message = describeMissingScope(SCOPES.write, [SCOPES.read]);

    expect(message).toContain(SCOPES.write);
    expect(message).toContain(SCOPES.read);
    expect(message).toContain('operator');
  });

  it('reads sensibly when the caller holds nothing at all', () => {
    expect(describeMissingScope(SCOPES.write, [])).toContain('no scopes');
  });
});

describe('credential storage', () => {
  it('stores only a hash, never the credential', () => {
    const store = temporaryStore();
    const secret = issueKey(store);

    expect(JSON.stringify(store.apiKeys)).not.toContain(secret);
    expect(store.apiKeys[0]?.hash).toBe(hashSecret(secret));
  });

  it('finds a key by its secret and ignores anything else', () => {
    const store = temporaryStore();
    const secret = issueKey(store);

    expect(store.findApiKeyBySecret(secret)?.id).toBe('test-key');
    expect(store.findApiKeyBySecret(`${secret}x`)).toBeUndefined();
    expect(store.findApiKeyBySecret('')).toBeUndefined();
  });

  it('picks up a revocation written by another process', () => {
    const directory = mkdtempSync(join(tmpdir(), 'todo-mcp-'));
    const writer = CredentialStore.forDataDir(directory);
    const reader = CredentialStore.forDataDir(directory);
    const secret = issueKey(writer, { id: 'shared' });

    // The reader has never seen this key: it was issued after it loaded.
    expect(reader.findApiKeyBySecret(secret)?.id).toBe('shared');

    writer.revokeApiKey('shared');

    // The running server must honour a revocation made from the CLI without
    // being restarted, which is what this asserts.
    expect(reader.findApiKeyBySecret(secret)?.revokedAt).toBeTruthy();
  });

  it('does not undo a change made by another process when it writes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'todo-mcp-'));
    const server = CredentialStore.forDataDir(directory);
    const cli = CredentialStore.forDataDir(directory);

    // The CLI issues a key and revokes it while the server holds an older copy
    // of the file in memory.
    const secret = issueKey(cli, { id: 'revoked-by-cli' });
    cli.revokeApiKey('revoked-by-cli');

    // The server then writes for an unrelated reason — an OAuth client
    // registering, say. Writing its stale state would erase the revocation, and
    // the key would start working again.
    server.addOAuthClient({
      clientId: 'client-1',
      clientName: 'Something',
      redirectUris: ['http://localhost/callback'],
      createdAt: new Date().toISOString(),
    });

    const fresh = CredentialStore.forDataDir(directory);
    expect(fresh.findApiKeyBySecret(secret)?.revokedAt).toBeTruthy();
    expect(fresh.oauthClients).toHaveLength(1);
  });

  it('survives a corrupt or absent file without inventing credentials', () => {
    const directory = mkdtempSync(join(tmpdir(), 'todo-mcp-'));
    expect(CredentialStore.forDataDir(directory).apiKeys).toEqual([]);

    writeFileSync(join(directory, 'credentials.json'), '{"version":1}');
    expect(CredentialStore.forDataDir(directory).apiKeys).toEqual([]);
  });

  it('drops expired refresh tokens but keeps spent ones, so replay stays visible', () => {
    const store = temporaryStore();
    const live = generateSecret('todo_rt');
    const spent = generateSecret('todo_rt');
    const stale = generateSecret('todo_rt');

    for (const [secret, expiresAt] of [
      [live, new Date(Date.now() + 60_000)],
      [spent, new Date(Date.now() + 60_000)],
      [stale, new Date(Date.now() - 60_000)],
    ] as const) {
      store.addRefreshToken({
        hash: hashSecret(secret),
        clientId: 'c',
        subject: 's',
        role: 'viewer',
        expiresAt: expiresAt.toISOString(),
      });
    }

    store.consumeRefreshToken(hashSecret(spent));
    store.pruneRefreshTokens();

    expect(store.findRefreshToken(live)).toBeDefined();
    expect(store.findRefreshToken(stale)).toBeUndefined();

    // A rotated token has to remain findable until it expires. Forgetting it
    // would make a replayed copy look like a token that never existed, and
    // theft would be indistinguishable from a typo.
    expect(store.findRefreshToken(spent)?.usedAt).toBeTruthy();
  });

  it('caps registered OAuth clients, since registration is unauthenticated', () => {
    const store = temporaryStore();

    for (let index = 0; index < 205; index++) {
      store.addOAuthClient({
        clientId: `client-${index}`,
        clientName: 'flood',
        redirectUris: ['http://localhost/callback'],
        createdAt: new Date().toISOString(),
      });
    }

    expect(store.oauthClients).toHaveLength(200);
    expect(store.findOAuthClient('client-0')).toBeUndefined();
    expect(store.findOAuthClient('client-204')).toBeDefined();
  });
});

describe('credential verification', () => {
  let store: CredentialStore;
  let tokens: AccessTokenRegistry;
  let verifier: CredentialVerifier;

  beforeEach(() => {
    store = temporaryStore();
    tokens = new AccessTokenRegistry();
    verifier = new CredentialVerifier(store, tokens, 'http://localhost:3001');
  });

  it('resolves a valid key to its role scopes and expiry', async () => {
    const secret = issueKey(store, { role: 'operator', id: 'op-1' });

    const auth = await verifier.verifyAccessToken(secret);

    expect(auth.clientId).toBe('op-1');
    expect(auth.scopes).toEqual([SCOPES.read, SCOPES.write]);
    // requireBearerAuth refuses a credential with no expiry, so this must be set.
    expect(auth.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it.each([
    ['an unknown key', () => generateSecret(API_KEY_PREFIX)],
    ['an empty string', () => ''],
    ['a token of another shape', () => 'not-even-close'],
  ])('rejects %s', async (_label, make) => {
    await expect(verifier.verifyAccessToken(make())).rejects.toThrow();
  });

  it('rejects an expired key', async () => {
    const secret = issueKey(store, { expiresAt: new Date(Date.now() - 1_000).toISOString() });

    await expect(verifier.verifyAccessToken(secret)).rejects.toThrow();
  });

  it('rejects a revoked key', async () => {
    const secret = issueKey(store, { id: 'doomed' });
    store.revokeApiKey('doomed');

    await expect(verifier.verifyAccessToken(secret)).rejects.toThrow();
  });

  it('gives the same message however a credential fails, so nothing is probeable', async () => {
    const expired = issueKey(store, {
      id: 'a',
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const revoked = issueKey(store, { id: 'b' });
    store.revokeApiKey('b');

    const messages = await Promise.all(
      [expired, revoked, generateSecret(API_KEY_PREFIX)].map((secret) =>
        verifier.verifyAccessToken(secret).catch((error: Error) => error.message),
      ),
    );

    expect(new Set(messages).size).toBe(1);
  });

  it('accepts a live OAuth access token and forgets it once it expires', async () => {
    tokens.issue('todo_at_live', {
      clientId: 'client-1',
      subject: 'user_1',
      role: 'viewer',
      expiresAt: Date.now() + 60_000,
    });
    tokens.issue('todo_at_stale', {
      clientId: 'client-1',
      subject: 'user_1',
      role: 'viewer',
      expiresAt: Date.now() - 1,
    });

    await expect(verifier.verifyAccessToken('todo_at_live')).resolves.toMatchObject({
      clientId: 'client-1',
      scopes: [SCOPES.read],
    });
    await expect(verifier.verifyAccessToken('todo_at_stale')).rejects.toThrow();
  });

  it('refuses a token minted for a different resource, and honours slash variance', async () => {
    tokens.issue('todo_at_elsewhere', {
      clientId: 'client-1',
      subject: 'user_1',
      role: 'operator',
      expiresAt: Date.now() + 60_000,
      resource: 'https://another-service.example.com/mcp',
    });
    // The same identity save for a trailing slash: one resource, not two.
    tokens.issue('todo_at_here', {
      clientId: 'client-1',
      subject: 'user_1',
      role: 'operator',
      expiresAt: Date.now() + 60_000,
      resource: 'http://localhost:3001/',
    });

    await expect(verifier.verifyAccessToken('todo_at_elsewhere')).rejects.toThrow();
    await expect(verifier.verifyAccessToken('todo_at_here')).resolves.toMatchObject({
      clientId: 'client-1',
    });
  });

  it('revokes every access token belonging to a subject at once', async () => {
    tokens.issue('todo_at_1', {
      clientId: 'c',
      subject: 'user_x',
      role: 'operator',
      expiresAt: Date.now() + 60_000,
    });
    tokens.issue('todo_at_2', {
      clientId: 'c',
      subject: 'user_x',
      role: 'operator',
      expiresAt: Date.now() + 60_000,
    });

    tokens.revokeAllForSubject('user_x');

    await expect(verifier.verifyAccessToken('todo_at_1')).rejects.toThrow();
    await expect(verifier.verifyAccessToken('todo_at_2')).rejects.toThrow();
  });
});

describe('the OAuth provider token lifecycle', () => {
  async function authorized() {
    const store = temporaryStore();
    const accessTokens = new AccessTokenRegistry();
    const provider = new TodoOAuthProvider({
      store,
      accessTokens,
      verifier: new CredentialVerifier(store, accessTokens, 'http://localhost:3001'),
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 86_400,
    });

    const code = provider.completeAuthorization({
      clientId: 'client-1',
      redirectUri: 'http://localhost/callback',
      codeChallenge: 'challenge',
      role: 'operator',
      subject: 'user_a',
    });
    const tokens = await provider.exchangeAuthorizationCode({ client_id: 'client-1' }, code);

    return { provider, accessTokens, tokens };
  }

  it('ends the whole session when a rotated refresh token is replayed', async () => {
    const { provider, accessTokens, tokens } = await authorized();

    // The legitimate exchange: the original refresh token is now spent and a
    // successor exists, along with a fresh access token.
    const rotated = await provider.exchangeRefreshToken(
      { client_id: 'client-1' },
      tokens.refresh_token as string,
    );

    // A replay of the spent token proves it was copied at some point. Refusing
    // only the replay would leave the successor alive in unknown hands.
    await expect(
      provider.exchangeRefreshToken({ client_id: 'client-1' }, tokens.refresh_token as string),
    ).rejects.toThrow(/already used/);

    await expect(
      provider.exchangeRefreshToken({ client_id: 'client-1' }, rotated.refresh_token as string),
    ).rejects.toThrow();
    expect(accessTokens.get(rotated.access_token)).toBeUndefined();
  });

  it('revokes a presented access token immediately, not just refresh tokens', async () => {
    const { provider, accessTokens, tokens } = await authorized();

    expect(accessTokens.get(tokens.access_token)).toBeDefined();

    await provider.revokeToken({ client_id: 'client-1' }, { token: tokens.access_token });

    expect(accessTokens.get(tokens.access_token)).toBeUndefined();
  });

  it('binds the requested resource to tokens across the refresh cycle', async () => {
    const store = temporaryStore();
    const accessTokens = new AccessTokenRegistry();
    const verifier = new CredentialVerifier(store, accessTokens, 'http://localhost:3001');
    const provider = new TodoOAuthProvider({
      store,
      accessTokens,
      verifier,
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 86_400,
    });

    const code = provider.completeAuthorization({
      clientId: 'client-1',
      redirectUri: 'http://localhost/callback',
      codeChallenge: 'challenge',
      role: 'operator',
      subject: 'user_b',
      resource: 'https://another-service.example.com/',
    });
    const minted = await provider.exchangeAuthorizationCode({ client_id: 'client-1' }, code);

    // Minted for another resource: this server must refuse it — and must keep
    // refusing after a refresh, which is why the binding has to survive rotation.
    await expect(verifier.verifyAccessToken(minted.access_token)).rejects.toThrow();

    const refreshed = await provider.exchangeRefreshToken(
      { client_id: 'client-1' },
      minted.refresh_token as string,
    );
    await expect(verifier.verifyAccessToken(refreshed.access_token)).rejects.toThrow();
  });
});
