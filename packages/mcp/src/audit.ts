import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';

export type AuditOutcome = 'success' | 'denied' | 'error';

export interface AuditEntry {
  readonly timestamp: string;
  /** Which credential acted: a key id or an OAuth client id, never the secret. */
  readonly clientId: string;
  readonly credential: string;
  readonly role: string;
  readonly tool: string;
  readonly arguments: unknown;
  readonly scopes: readonly string[];
  readonly outcome: AuditOutcome;
  /** Why a call was denied or how it failed. Absent on success. */
  readonly reason?: string;
  readonly transactionHash?: string;
  readonly durationMs: number;
}

/**
 * Append-only record of every tool call.
 *
 * Denials and failures are recorded as carefully as successes: the question an
 * audit trail exists to answer is usually "who tried to do this", not "what
 * worked". Entries are one JSON object per line so the file can be read with
 * ordinary tools and appended to safely.
 *
 * Nothing here records a credential. The client id identifies who acted; the
 * secret they used never enters the log.
 */
export class AuditLog {
  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  record(entry: AuditEntry): void {
    // Mirrored to the service log so an operator watching the console sees
    // activity without tailing a second file.
    this.logger.info(
      {
        audit: true,
        tool: entry.tool,
        clientId: entry.clientId,
        outcome: entry.outcome,
        durationMs: entry.durationMs,
        ...(entry.transactionHash ? { transactionHash: entry.transactionHash } : {}),
      },
      entry.reason ?? `${entry.tool} ${entry.outcome}`,
    );

    try {
      appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch (error) {
      // A broken audit file must not take the service down, but it must not
      // pass unnoticed either.
      this.logger.error({ err: error }, 'failed to write audit entry');
    }
  }
}
