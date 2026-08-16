import type { ApiErrorBody, Health, Task, WriteOutcome } from './types.js';

/**
 * The only place in the client that speaks HTTP.
 *
 * Everything above it works with `Task` values and `ApiError`s, so a change to
 * the transport — a different base URL, an auth header, a retry policy — is a
 * change here and nowhere else.
 */

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/**
 * A failure the API described. `code` is the server's stable identifier, so the
 * UI can react to a specific case (an already-completed task, say) without
 * matching on prose.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: ApiErrorBody['error']['details'],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the API could not be reached at all, rather than refusing. */
  get isUnreachable(): boolean {
    return this.status === 0;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, init);
  } catch {
    // A network-level failure has no response to read: the server is down, the
    // origin is blocked, or the browser is offline. Say which URL failed, since
    // a misconfigured VITE_API_URL looks identical to a stopped server.
    throw new ApiError('API_UNREACHABLE', `Cannot reach the API at ${BASE_URL}.`, 0);
  }

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const described = (body as ApiErrorBody | undefined)?.error;
    throw new ApiError(
      described?.code ?? 'UNEXPECTED_ERROR',
      described?.message ?? `The API responded with ${response.status}.`,
      response.status,
      described?.details,
    );
  }

  return body as T;
}

export function getHealth(): Promise<Health> {
  return request<Health>('/health');
}

export function getTasks(): Promise<Task[]> {
  return request<Task[]>('/tasks');
}

/**
 * Both writes resolve with either outcome of a transaction: `confirmed` when a
 * receipt was seen, `pending` when it was accepted but did not confirm in time.
 * A pending result is not an error and must not be treated as one — it carries
 * the transaction hash, which is the only way to track the write from here.
 */
export function addTask(description: string): Promise<WriteOutcome> {
  return request<WriteOutcome>('/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
}

export function completeTask(id: number): Promise<WriteOutcome> {
  return request<WriteOutcome>(`/tasks/${id}/complete`, { method: 'POST' });
}
