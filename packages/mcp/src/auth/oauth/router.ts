import { mcpAuthRouter } from '@modelcontextprotocol/server-legacy/auth';
import express, { Router, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import { isRole, SCOPES } from '../scopes.js';
import type { CredentialStore } from '../store.js';
import { verifyConsent, type ConsentRequest } from './consent.js';
import { newSubjectId, type TodoOAuthProvider } from './provider.js';

export interface OAuthRoutesOptions {
  readonly provider: TodoOAuthProvider;
  readonly store: CredentialStore;
  readonly issuerUrl: string;
  readonly logger: Logger;
}

/**
 * Mounts the OAuth 2.1 authorization server.
 *
 * The SDK router provides the protocol endpoints — metadata discovery,
 * dynamic client registration, the authorization and token endpoints, PKCE
 * verification and revocation. Only the consent submission is ours, because
 * only we know what a role means here.
 */
export function createOAuthRoutes(options: OAuthRoutesOptions): RequestHandler[] {
  const { provider, store, issuerUrl, logger } = options;

  const sdkRouter = mcpAuthRouter({
    provider: provider as never,
    issuerUrl: new URL(issuerUrl),
    scopesSupported: Object.values(SCOPES),
    resourceName: 'Blockchain TODO list',
  });

  return [sdkRouter, createConsentRoute({ provider, store, issuerUrl, logger })];
}

function createConsentRoute({ provider, store, issuerUrl, logger }: OAuthRoutesOptions): Router {
  const router = Router();

  router.post('/oauth/consent', express.urlencoded({ extended: false }), (req, res) => {
    const body = req.body as Record<string, string | undefined>;

    const request: ConsentRequest = {
      clientId: body['client_id'] ?? '',
      // The name is not part of the signature; it is presentation only.
      clientName: '',
      redirectUri: body['redirect_uri'] ?? '',
      codeChallenge: body['code_challenge'] ?? '',
      ...(body['state'] ? { state: body['state'] } : {}),
      ...(body['resource'] ? { resource: body['resource'] } : {}),
    };

    // The form travels through the browser, so its contents are attacker
    // controlled until proven otherwise. The signature proves this server
    // issued the request; without it, any site could post a consent for a
    // redirect URI of its choosing.
    if (!verifyConsent(request, body['signature'] ?? '')) {
      logger.warn({ clientId: request.clientId }, 'rejected an unsigned consent submission');
      res.status(400).send('This authorization request is invalid or has expired. Start again.');
      return;
    }

    // Checked a second time against what the client registered, so a tampered
    // or replayed form cannot redirect a code somewhere else.
    const client = store.findOAuthClient(request.clientId);
    if (!client || !client.redirectUris.includes(request.redirectUri)) {
      logger.warn({ clientId: request.clientId }, 'consent used an unregistered redirect URI');
      res.status(400).send('This authorization request is invalid or has expired. Start again.');
      return;
    }

    if (body['decision'] !== 'allow') {
      logger.info({ clientId: request.clientId }, 'authorization denied by the user');
      res.redirect(buildRedirect(request.redirectUri, { error: 'access_denied' }, request.state));
      return;
    }

    const role = body['role'] ?? '';
    if (!isRole(role)) {
      res.status(400).send('Choose a role before authorizing.');
      return;
    }

    const code = provider.completeAuthorization({
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      role,
      subject: newSubjectId(),
      ...(request.resource ? { resource: request.resource } : {}),
    });

    logger.info({ clientId: request.clientId, role }, 'authorization granted');

    // This redirect comes from our response rather than the SDK's, so RFC 9207
    // `iss` has to be added here.
    res.redirect(buildRedirect(request.redirectUri, { code, iss: issuerUrl }, request.state));
  });

  return router;
}

function buildRedirect(
  redirectUri: string,
  params: Record<string, string>,
  state?: string,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}
