import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TodoService, WriteResult } from '@todo/core';
import { pino } from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLog } from './audit.js';
import { TodoOAuthProvider } from './auth/oauth/provider.js';
import { createOAuthRoutes } from './auth/oauth/router.js';
import { CredentialStore, generateSecret, hashSecret } from './auth/store.js';
import { AccessTokenRegistry, API_KEY_PREFIX, CredentialVerifier } from './auth/verifier.js';
import { createMcpApp } from './server.js';

const TX_HASH = `0x${'ef'.repeat(32)}` as const;

const writeResult: WriteResult = {
  task: { id: 5, description: 'ship it', completed: false },
  transaction: {
    hash: TX_HASH,
    explorerUrl: `https://sepolia.etherscan.io/tx/${TX_HASH}`,
    blockNumber: 42,
    gasUsed: '90000',
  },
};

const service = {
  getTasks: vi.fn(),
  addTask: vi.fn(),
  completeTask: vi.fn(),
};

let auditPath: string;
let viewerKey: string;
let operatorKey: string;
let app: ReturnType<typeof createMcpApp>;

beforeEach(() => {
  vi.resetAllMocks();

  const dataDir = mkdtempSync(join(tmpdir(), 'todo-mcp-server-'));
  auditPath = join(dataDir, 'audit.jsonl');

  const store = CredentialStore.forDataDir(dataDir);
  viewerKey = generateSecret(API_KEY_PREFIX);
  operatorKey = generateSecret(API_KEY_PREFIX);

  for (const [secret, role, id] of [
    [viewerKey, 'viewer', 'viewer-1'],
    [operatorKey, 'operator', 'operator-1'],
  ] as const) {
    store.addApiKey({
      id,
      label: role,
      hash: hashSecret(secret),
      role,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
  }

  const logger = pino({ level: 'silent' });
  const accessTokens = new AccessTokenRegistry();
  const verifier = new CredentialVerifier(store, accessTokens);

  // Mounted exactly as the service does, so discovery is covered too.
  const provider = new TodoOAuthProvider({
    store,
    accessTokens,
    verifier,
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 86_400,
  });

  app = createMcpApp({
    service: service as unknown as TodoService,
    audit: new AuditLog(auditPath, logger),
    verifier,
    logger,
    publicUrl: 'http://localhost:3001',
    oauthRoutes: createOAuthRoutes({
      provider,
      store,
      issuerUrl: 'http://localhost:3001',
      logger,
    }),
  });
});

/** Issues a JSON-RPC call the way an MCP client would. */
function rpc(key: string | undefined, body: Record<string, unknown>) {
  const call = request(app)
    .post('/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json');

  if (key) call.set('Authorization', `Bearer ${key}`);
  return call.send(body);
}

/** Responses arrive as server-sent events; this pulls the JSON-RPC payload out. */
function payload(text: string): { result?: Record<string, unknown> } {
  const line = text.split('\n').find((candidate) => candidate.startsWith('data: '));
  return JSON.parse(line?.slice(6) ?? '{}') as { result?: Record<string, unknown> };
}

function resultText(text: string): string {
  const content = payload(text).result?.['content'] as Array<{ text: string }> | undefined;
  return content?.map((entry) => entry.text).join('\n') ?? '';
}

function auditEntries(): Array<Record<string, unknown>> {
  try {
    return readFileSync(auditPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

describe('authentication', () => {
  it('refuses a request with no credential and says where to authenticate', async () => {
    const response = await rpc(undefined, { jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toContain('resource_metadata=');
  });

  it('refuses an unknown credential', async () => {
    const response = await rpc('todo_key_invented', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });

    expect(response.status).toBe(401);
  });

  it('serves protected resource metadata so a client can discover the flow', async () => {
    const response = await request(app).get('/.well-known/oauth-protected-resource').expect(200);

    expect(response.body.scopes_supported).toEqual(
      expect.arrayContaining(['tasks:read', 'tasks:write']),
    );
  });
});

describe('tool visibility', () => {
  it('offers every tool to an authenticated caller', async () => {
    const response = await rpc(viewerKey, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = (payload(response.text).result?.['tools'] as Array<{ name: string }>).map(
      (tool) => tool.name,
    );

    expect(names).toEqual(['getTasks', 'addTask', 'completeTask']);
  });

  it('warns a read-only caller that write tools will be refused', async () => {
    const response = await rpc(viewerKey, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = payload(response.text).result?.['tools'] as Array<{
      name: string;
      description: string;
    }>;

    const addTask = tools.find((tool) => tool.name === 'addTask');
    expect(addTask?.description).toContain('read-only');
  });

  it('does not warn an operator', async () => {
    const response = await rpc(operatorKey, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = payload(response.text).result?.['tools'] as Array<{
      name: string;
      description: string;
    }>;

    expect(tools.find((tool) => tool.name === 'addTask')?.description).not.toContain('read-only');
  });
});

describe('scope enforcement', () => {
  it('lets a viewer read', async () => {
    service.getTasks.mockResolvedValue([{ id: 0, description: 'first', completed: false }]);

    const response = await rpc(viewerKey, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'getTasks', arguments: {} },
    });

    expect(resultText(response.text)).toContain('#0 first');
  });

  it.each(['addTask', 'completeTask'])(
    'refuses %s for a viewer, naming the scope required',
    async (tool) => {
      const args =
        tool === 'addTask' ? { description: 'x', confirm: true } : { taskId: 1, confirm: true };

      const response = await rpc(viewerKey, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      });

      const text = resultText(response.text);
      expect(text).toContain('insufficient_scope');
      expect(text).toContain('tasks:write');
      expect(service.addTask).not.toHaveBeenCalled();
      expect(service.completeTask).not.toHaveBeenCalled();
    },
  );

  it('records a denial in the audit trail', async () => {
    await rpc(viewerKey, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'addTask', arguments: { description: 'x', confirm: true } },
    });

    expect(auditEntries()).toEqual([
      expect.objectContaining({ tool: 'addTask', outcome: 'denied', clientId: 'viewer-1' }),
    ]);
  });
});

describe('confirmation before writing', () => {
  it('does not touch the chain when confirmation is missing', async () => {
    const response = await rpc(operatorKey, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'addTask', arguments: { description: 'unconfirmed' } },
    });

    expect(resultText(response.text)).toContain('Confirmation required');
    expect(service.addTask).not.toHaveBeenCalled();
  });

  it('records the unconfirmed attempt so an auditor sees it', async () => {
    await rpc(operatorKey, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'completeTask', arguments: { taskId: 3 } },
    });

    expect(auditEntries()).toEqual([
      expect.objectContaining({ outcome: 'denied', reason: 'awaiting confirmation' }),
    ]);
  });

  it('proceeds once confirmed, and audits the transaction hash', async () => {
    service.addTask.mockResolvedValue(writeResult);

    const response = await rpc(operatorKey, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'addTask', arguments: { description: 'ship it', confirm: true } },
    });

    expect(service.addTask).toHaveBeenCalledWith('ship it');
    expect(resultText(response.text)).toContain('Added task #5');
    expect(auditEntries()).toEqual([
      expect.objectContaining({ outcome: 'success', transactionHash: TX_HASH }),
    ]);
  });
});

describe('failures reaching the client', () => {
  it('reports a typed core failure in words a person can act on', async () => {
    const { TaskAlreadyCompletedError } = await import('@todo/core');
    service.completeTask.mockRejectedValue(new TaskAlreadyCompletedError(3));

    const response = await rpc(operatorKey, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'completeTask', arguments: { taskId: 3, confirm: true } },
    });

    expect(resultText(response.text)).toContain('Task 3 is already completed');
  });

  it('says nothing specific about an unexpected failure', async () => {
    service.getTasks.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:8545'));

    const response = await rpc(viewerKey, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'getTasks', arguments: {} },
    });

    const text = resultText(response.text);
    expect(text).toContain('failed unexpectedly');
    expect(text).not.toContain('10.0.0.5');
  });

  it('never writes a credential into the audit trail', async () => {
    service.getTasks.mockResolvedValue([]);

    await rpc(operatorKey, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'getTasks', arguments: {} },
    });

    expect(readFileSync(auditPath, 'utf8')).not.toContain(operatorKey);
  });
});
