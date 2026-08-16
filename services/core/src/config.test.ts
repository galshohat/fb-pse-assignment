import { describe, expect, it } from 'vitest';
import { ConfigError, loadCoreConfig } from './config.js';

const VALID_KEY = `0x${'a1'.repeat(32)}`;

function problemsFrom(env: NodeJS.ProcessEnv): string[] {
  try {
    loadCoreConfig(env);
    return [];
  } catch (error) {
    return error instanceof ConfigError ? [...error.problems] : [`unexpected: ${String(error)}`];
  }
}

describe('loadCoreConfig', () => {
  it('applies defaults for everything except the signing key', () => {
    const config = loadCoreConfig({ WALLET_PRIVATE_KEY: VALID_KEY });

    expect(config.contractAddress).toBe('0xdF52AD4b53a094B97cA4a056d7f51b82E3b795c8');
    expect(config.rpcUrls.length).toBeGreaterThan(1);
    expect(config.confirmations).toBe(1);
    expect(config.txTimeoutMs).toBe(120_000);
  });

  it('names the signing key as required when it is absent', () => {
    expect(problemsFrom({})).toEqual(['WALLET_PRIVATE_KEY: is required']);
  });

  it('never repeats a rejected value back, because one of them is a private key', () => {
    const secret = 'this-is-not-a-key-but-would-be-in-production';

    const problems = problemsFrom({ WALLET_PRIVATE_KEY: secret });

    expect(problems).toHaveLength(1);
    expect(problems[0]).not.toContain(secret);
    expect(problems[0]).toContain('WALLET_PRIVATE_KEY');
  });

  it('rejects a key of the wrong length', () => {
    const problems = problemsFrom({ WALLET_PRIVATE_KEY: `0x${'a1'.repeat(16)}` });

    expect(problems[0]).toContain('32-byte hex string');
  });

  it('splits and trims the RPC list', () => {
    const config = loadCoreConfig({
      WALLET_PRIVATE_KEY: VALID_KEY,
      RPC_URLS: ' https://one.example , https://two.example ',
    });

    expect(config.rpcUrls).toEqual(['https://one.example', 'https://two.example']);
  });

  it('rejects an RPC list that contains something which is not a URL', () => {
    const problems = problemsFrom({ WALLET_PRIVATE_KEY: VALID_KEY, RPC_URLS: 'https://ok, junk' });

    expect(problems[0]).toContain('RPC_URLS');
  });

  it('coerces numeric settings from strings and enforces their bounds', () => {
    const config = loadCoreConfig({
      WALLET_PRIVATE_KEY: VALID_KEY,
      TX_CONFIRMATIONS: '3',
      TX_TIMEOUT_MS: '60000',
    });

    expect(config.confirmations).toBe(3);
    expect(config.txTimeoutMs).toBe(60_000);
    expect(problemsFrom({ WALLET_PRIVATE_KEY: VALID_KEY, TX_CONFIRMATIONS: '0' })).toHaveLength(1);
    expect(problemsFrom({ WALLET_PRIVATE_KEY: VALID_KEY, TX_TIMEOUT_MS: '10' })).toHaveLength(1);
  });

  it('reports every problem at once rather than one per run', () => {
    const problems = problemsFrom({ WALLET_PRIVATE_KEY: 'bad', TX_CONFIRMATIONS: '99' });

    expect(problems).toHaveLength(2);
  });
});
