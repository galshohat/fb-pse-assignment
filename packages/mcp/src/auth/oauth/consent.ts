import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ROLE_NAMES, scopesForRole, type Role } from '../scopes.js';

/**
 * Consent requests are signed so that the browser can carry them between the
 * authorize page and the consent submission without becoming a way to forge
 * an authorization. The key lives only in memory: a restart invalidates
 * in-flight consent pages, which is the correct outcome for a 60-second flow.
 */
const SIGNING_KEY = randomBytes(32);

export interface ConsentRequest {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly state?: string;
  readonly resource?: string;
}

export function signConsent(request: ConsentRequest): string {
  return createHmac('sha256', SIGNING_KEY).update(canonical(request)).digest('base64url');
}

export function verifyConsent(request: ConsentRequest, signature: string): boolean {
  const expected = Buffer.from(signConsent(request), 'utf8');
  const presented = Buffer.from(signature, 'utf8');
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

/**
 * Serialized with JSON rather than joined by a separator character. The fields
 * have to be unambiguously recoverable from the signed string, or two different
 * requests could share a signature; a separator does that job only as long as
 * the separator cannot appear in a field. This previously used a NUL byte,
 * which is safe but invisible — a reformat or a copy-paste turning it into a
 * space would silently reintroduce the ambiguity, with nothing to see in review.
 */
function canonical(request: ConsentRequest): string {
  return JSON.stringify([
    request.clientId,
    request.redirectUri,
    request.codeChallenge,
    request.state ?? '',
    request.resource ?? '',
  ]);
}

/**
 * The consent screen.
 *
 * It exists to make one thing unmissable before any credential is issued: the
 * operator role can spend money that cannot be recovered. Choosing a role here
 * is what maps a human decision onto the scopes the token will carry.
 */
export function consentPage(request: ConsentRequest, signature: string): string {
  const roleOptions = ROLE_NAMES.map((role) => roleOption(role)).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize ${escapeHtml(request.clientName)}</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --text:#12141a; --muted:#5b6472; --line:#e3e6ea; --accent:#2b62ff; --warn-bg:#fff6e6; --warn-line:#f0c67a; --warn-text:#6b4a00; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1115; --card:#171a21; --text:#e9ecf1; --muted:#9aa3b2; --line:#272b34; --accent:#5b86ff; --warn-bg:#2a2213; --warn-line:#5c4a1f; --warn-text:#f0c67a; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         background:var(--bg); color:var(--text);
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  .card { width:100%; max-width:460px; background:var(--card); border:1px solid var(--line);
          border-radius:14px; padding:28px; }
  h1 { margin:0 0 4px; font-size:19px; }
  p.lead { margin:0 0 20px; color:var(--muted); }
  .warn { background:var(--warn-bg); border:1px solid var(--warn-line); color:var(--warn-text);
          border-radius:9px; padding:11px 13px; margin-bottom:20px; font-size:13.5px; }
  fieldset { border:0; padding:0; margin:0 0 20px; }
  legend { font-weight:600; margin-bottom:9px; padding:0; }
  label.role { display:flex; gap:11px; align-items:flex-start; border:1px solid var(--line);
               border-radius:9px; padding:12px 13px; margin-bottom:8px; cursor:pointer; }
  label.role:has(input:checked) { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
  label.role:focus-within { outline:2px solid var(--accent); outline-offset:2px; }
  .role strong { display:block; }
  .role span { color:var(--muted); font-size:13px; }
  .actions { display:flex; gap:10px; }
  button { flex:1; padding:11px; border-radius:9px; border:1px solid var(--line);
           font-size:14.5px; font-weight:600; cursor:pointer; background:transparent; color:var(--text); }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  code { background:var(--bg); padding:1px 5px; border-radius:4px; font-size:12.5px; }
</style>
</head>
<body>
  <main class="card">
    <h1>Authorize ${escapeHtml(request.clientName)}</h1>
    <p class="lead">This client is asking to manage a to-do list stored on the Ethereum Sepolia blockchain.</p>

    <div class="warn">
      Granting write access lets this client send blockchain transactions from the
      server's wallet. Transactions spend testnet funds and cannot be reversed.
    </div>

    <form method="post" action="/oauth/consent">
      <input type="hidden" name="client_id" value="${escapeHtml(request.clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(request.redirectUri)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(request.codeChallenge)}">
      <input type="hidden" name="state" value="${escapeHtml(request.state ?? '')}">
      <input type="hidden" name="resource" value="${escapeHtml(request.resource ?? '')}">
      <input type="hidden" name="signature" value="${escapeHtml(signature)}">

      <fieldset>
        <legend>Grant this client:</legend>
        ${roleOptions}
      </fieldset>

      <div class="actions">
        <button type="submit" name="decision" value="deny">Deny</button>
        <button type="submit" name="decision" value="allow" class="primary">Authorize</button>
      </div>
    </form>
  </main>
</body>
</html>`;
}

function roleOption(role: Role): string {
  const summary: Record<Role, string> = {
    viewer: 'Read the task list only. Cannot spend anything.',
    operator: 'Read the list, and add and complete tasks. Spends gas.',
  };

  return `<label class="role">
          <input type="radio" name="role" value="${role}"${role === 'viewer' ? ' checked' : ''}>
          <span><strong>${role}</strong>
          <span>${summary[role]}</span>
          <span><code>${scopesForRole(role).join('</code> <code>')}</code></span></span>
        </label>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
