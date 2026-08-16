import { McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { isTodoError, MAX_DESCRIPTION_LENGTH, type TodoService } from '@todo/core';
import { z } from 'zod';
import type { AuditLog, AuditOutcome } from './audit.js';
import { describeMissingScope, hasScope, SCOPES, type Scope } from './auth/scopes.js';
import { confirmWrite, type RequestContext } from './confirmation.js';

/** Present on every write tool: the universal way to approve an action. */
const confirmArgument = z
  .boolean()
  .optional()
  .describe(
    'Set to true to approve sending the transaction. Omit it to be asked for confirmation first.',
  );

export interface ToolContext {
  readonly service: TodoService;
  readonly audit: AuditLog;
  readonly authInfo: AuthInfo | undefined;
}

/** What a tool handler returns to the client. */
type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/**
 * Builds the tool set for one caller.
 *
 * Every tool is registered for every authenticated caller, and scope is
 * enforced inside the handler. Hiding write tools from a read-only credential
 * was the first design and was rejected: an unregistered tool answers "tool
 * not found", which tells an operator their credential is fine and the server
 * is broken. The requirement is to refuse clearly, so the refusal has to name
 * the scope that was missing.
 *
 * What a read-only caller gets instead is an honest description saying the
 * tool will be refused, so a model can tell before calling it.
 */
export function buildServer(context: ToolContext): McpServer {
  const server = new McpServer({ name: 'blockchain-todo', version: '1.0.0' });
  const canWrite = hasScope(context.authInfo?.scopes ?? [], SCOPES.write);

  registerGetTasks(server, context);
  registerAddTask(server, context, canWrite);
  registerCompleteTask(server, context, canWrite);

  return server;
}

/** Warns a read-only caller before it spends a turn on a call that cannot work. */
function writeNotice(canWrite: boolean): string {
  return canWrite
    ? ''
    : ` Your current credential is read-only, so this call will be refused; an operator credential is required.`;
}

function registerGetTasks(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'getTasks',
    {
      title: 'List tasks',
      description:
        'Read every task on the shared to-do list, with its completion status. This is a read of public blockchain state: it costs nothing and changes nothing.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(context, 'getTasks', SCOPES.read, async () => {
      const tasks = await context.service.getTasks();

      if (tasks.length === 0) {
        return { result: text('The to-do list is empty.') };
      }

      const lines = tasks.map(
        (task) => `${task.completed ? '[x]' : '[ ]'} #${task.id} ${task.description}`,
      );

      return {
        result: text(
          `${tasks.length} task${tasks.length === 1 ? '' : 's'} on-chain:\n${lines.join('\n')}`,
        ),
      };
    }),
  );
}

function registerAddTask(server: McpServer, context: ToolContext, canWrite: boolean): void {
  server.registerTool(
    'addTask',
    {
      title: 'Add a task',
      description:
        'Add a task to the shared to-do list. This sends a blockchain transaction: it spends gas, takes around fifteen seconds to confirm, and cannot be undone.' +
        writeNotice(canWrite),
      inputSchema: z.object({
        description: z
          .string()
          .min(1)
          .max(MAX_DESCRIPTION_LENGTH)
          .describe('What the task says. Must not be empty.'),
        confirm: confirmArgument,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    guard(context, 'addTask', SCOPES.write, async ({ description, confirm }, ctx) => {
      const approval = await confirmWrite(ctx, confirm, `Add the task "${description}".`);
      if (!approval.confirmed) return { unconfirmed: approval.reason };

      const { task, transaction } = await context.service.addTask(description);

      return {
        result: text(
          `Added task #${task.id}: "${task.description}".\nConfirmed in block ${transaction.blockNumber}, ${transaction.gasUsed} gas.\n${transaction.explorerUrl}`,
        ),
        transactionHash: transaction.hash,
      };
    }),
  );
}

function registerCompleteTask(server: McpServer, context: ToolContext, canWrite: boolean): void {
  server.registerTool(
    'completeTask',
    {
      title: 'Complete a task',
      description:
        'Mark a task as completed. This sends a blockchain transaction: it spends gas, takes around fifteen seconds to confirm, and cannot be undone. A task cannot be un-completed.' +
        writeNotice(canWrite),
      inputSchema: z.object({
        taskId: z
          .number()
          .int()
          .min(0)
          .describe('The id of the task to complete, as shown by getTasks. Ids start at 0.'),
        confirm: confirmArgument,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(context, 'completeTask', SCOPES.write, async ({ taskId, confirm }, ctx) => {
      const approval = await confirmWrite(ctx, confirm, `Mark task #${taskId} as completed.`);
      if (!approval.confirmed) return { unconfirmed: approval.reason };

      const { task, transaction } = await context.service.completeTask(taskId);

      return {
        result: text(
          `Completed task #${task.id}: "${task.description}".\nConfirmed in block ${transaction.blockNumber}, ${transaction.gasUsed} gas.\n${transaction.explorerUrl}`,
        ),
        transactionHash: transaction.hash,
      };
    }),
  );
}

/**
 * A handler either did the work, or stopped because the caller has not
 * approved it yet. The second case is not a failure and must not read like
 * one — nothing was attempted.
 */
type HandlerOutcome =
  | { readonly result: ToolResult; readonly transactionHash?: string }
  | { readonly unconfirmed: string };

/**
 * Wraps a tool handler with the two things every tool needs: a scope check
 * that refuses clearly, and an audit entry whatever the outcome.
 */
function guard<Args>(
  context: ToolContext,
  tool: string,
  required: Scope,
  handler: (args: Args, ctx: RequestContext) => Promise<HandlerOutcome>,
) {
  return async (args: Args, ctx: RequestContext): Promise<ToolResult> => {
    const startedAt = Date.now();
    const scopes = context.authInfo?.scopes ?? [];

    const finish = (
      outcome: AuditOutcome,
      extra: { reason?: string; transactionHash?: string },
    ) => {
      context.audit.record({
        timestamp: new Date().toISOString(),
        clientId: context.authInfo?.clientId ?? 'anonymous',
        credential: String(context.authInfo?.extra?.['credential'] ?? 'none'),
        role: String(context.authInfo?.extra?.['role'] ?? 'none'),
        tool,
        arguments: args,
        scopes,
        outcome,
        durationMs: Date.now() - startedAt,
        ...extra,
      });
    };

    // The only authorization gate. Tools are offered to everyone, so this
    // check is what separates a viewer from an operator.
    if (!hasScope(scopes, required)) {
      const reason = describeMissingScope(required, scopes);
      finish('denied', { reason });
      return { content: [{ type: 'text', text: reason }], isError: true };
    }

    try {
      const outcome = await handler(args, ctx);

      // Recorded as a denial rather than a success: nothing reached the chain,
      // and an auditor needs to see the attempt as well as any approval that
      // follows it.
      if ('unconfirmed' in outcome) {
        finish('denied', { reason: 'awaiting confirmation' });
        return { content: [{ type: 'text', text: outcome.unconfirmed }], isError: true };
      }

      finish(
        'success',
        outcome.transactionHash ? { transactionHash: outcome.transactionHash } : {},
      );
      return outcome.result;
    } catch (error) {
      // Typed failures carry a message written for a person; anything else is
      // a bug and is not described to the caller.
      const reason = isTodoError(error)
        ? `${error.code}: ${error.message}`
        : 'The operation failed unexpectedly.';

      finish('error', { reason });
      return { content: [{ type: 'text', text: reason }], isError: true };
    }
  };
}

function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] };
}
