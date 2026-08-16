import { z } from 'zod';

/**
 * Public Sepolia endpoints used when `RPC_URLS` is not set. Several are listed
 * because public endpoints rate-limit and go down; the client fails over.
 */
const DEFAULT_RPC_URLS = [
  'https://ethereum-sepolia-public.nodies.app',
  'https://gateway.tenderly.co/public/sepolia',
  'https://eth-sepolia-testnet.api.pocket.network',
  'https://ethereum-sepolia.gateway.tatum.io',
].join(',');

const DEFAULT_CONTRACT_ADDRESS = '0xdF52AD4b53a094B97cA4a056d7f51b82E3b795c8';

/**
 * Messages read as `VARIABLE: <message>` once prefixed with the failing path,
 * so they are phrased as sentence fragments rather than repeating the name.
 */
const hexString = (bytes: number) =>
  z
    .string({ error: (issue) => (issue.input === undefined ? 'is required' : 'must be a string') })
    .regex(
      new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`),
      `must be a 0x-prefixed ${bytes}-byte hex string`,
    );

const coreEnvSchema = z.object({
  WALLET_PRIVATE_KEY: hexString(32),
  CONTRACT_ADDRESS: hexString(20).default(DEFAULT_CONTRACT_ADDRESS),
  RPC_URLS: z
    .string()
    .default(DEFAULT_RPC_URLS)
    .transform((value) =>
      value
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean),
    )
    .refine((urls) => urls.length > 0, 'must contain at least one URL')
    .refine(
      (urls) => urls.every((url) => URL.canParse(url)),
      'must be a comma-separated list of valid URLs',
    ),
  TX_CONFIRMATIONS: z.coerce.number().int().min(1).max(12).default(1),
  TX_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
});

export interface CoreConfig {
  /** Signing key for the hot wallet. Held in memory only; never logged or persisted. */
  readonly privateKey: `0x${string}`;
  readonly contractAddress: `0x${string}`;
  /** RPC endpoints in priority order; the transport fails over down this list. */
  readonly rpcUrls: readonly string[];
  readonly confirmations: number;
  readonly txTimeoutMs: number;
}

/**
 * Raised when the environment is missing or malformed. Reports which variables
 * are wrong and why, but never the values themselves — one of them is a
 * private key, and configuration errors are usually printed to a log.
 */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';

  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

/** Formats zod issues as `VARIABLE: reason`, discarding any received values. */
function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const variable = issue.path.join('.');
    return variable ? `${variable}: ${issue.message}` : issue.message;
  });
}

/**
 * Validates the blockchain-related environment. Called once at startup so a
 * misconfigured service fails immediately rather than at the first request.
 */
export function loadCoreConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const parsed = coreEnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new ConfigError(describeIssues(parsed.error));
  }

  return {
    privateKey: parsed.data.WALLET_PRIVATE_KEY as `0x${string}`,
    contractAddress: parsed.data.CONTRACT_ADDRESS as `0x${string}`,
    rpcUrls: parsed.data.RPC_URLS,
    confirmations: parsed.data.TX_CONFIRMATIONS,
    txTimeoutMs: parsed.data.TX_TIMEOUT_MS,
  };
}
