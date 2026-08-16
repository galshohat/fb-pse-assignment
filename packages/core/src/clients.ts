import { createPublicClient, createWalletClient, fallback, http } from 'viem';
import type { Chain, PublicClient, Transport, WalletClient } from 'viem';
import { nonceManager, privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import type { CoreConfig } from './config.js';

/**
 * Clients are annotated with viem's general client types rather than letting
 * TypeScript infer them. The inferred types are too large for the compiler to
 * serialize into declaration files, which a composite project needs.
 */
export interface ChainClients {
  readonly account: PrivateKeyAccount;
  readonly publicClient: PublicClient<Transport, Chain>;
  readonly walletClient: WalletClient<Transport, Chain, PrivateKeyAccount>;
}

/** Per-endpoint request timeout. Public RPCs are slow often enough to matter. */
const RPC_TIMEOUT_MS = 10_000;

/** Retries against one endpoint before the transport moves to the next. */
const RPC_RETRY_COUNT = 2;

/**
 * Builds the clients used for all chain access.
 *
 * Reads and writes share a `fallback` transport over every configured RPC
 * endpoint: requests go to the first endpoint and move down the list when one
 * times out or rate-limits. Public Sepolia endpoints do both routinely, so
 * treating a single endpoint as reliable would make the service flaky.
 *
 * The account is created with viem's `nonceManager`, which assigns sequential
 * nonces to concurrent sends. This is a second line of defence: writes are also
 * serialized by a mutex in the transaction queue, but the nonce manager still
 * helps when more than one process shares the wallet, where an in-process lock
 * cannot.
 */
export function createChainClients(config: CoreConfig): ChainClients {
  const account = privateKeyToAccount(config.privateKey, { nonceManager });

  const transport = fallback(
    config.rpcUrls.map((url) =>
      http(url, { timeout: RPC_TIMEOUT_MS, retryCount: RPC_RETRY_COUNT }),
    ),
  );

  return {
    account,
    publicClient: createPublicClient({ chain: sepolia, transport }),
    walletClient: createWalletClient({ chain: sepolia, account, transport }),
  };
}

/** The chain every service in this workspace talks to. */
export const CHAIN = { id: sepolia.id, name: sepolia.name } as const;

/** Block explorer link for a transaction, taken from the chain definition. */
export function explorerTransactionUrl(hash: string): string {
  return `${sepolia.blockExplorers.default.url}/tx/${hash}`;
}

/** Block explorer link for an address — a contract, or the signing wallet. */
export function explorerAddressUrl(address: string): string {
  return `${sepolia.blockExplorers.default.url}/address/${address}`;
}
