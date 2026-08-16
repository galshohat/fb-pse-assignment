import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getHealth, getTasks } from '../api/client.js';
import type { Health, Task } from '../api/types.js';

/**
 * Server state lives in TanStack Query, never mirrored into `useState`. The
 * list belongs to the contract, not to this browser tab: the MCP server and
 * anyone else with the address write to the same list, so the client treats
 * what it holds as a cache of a shared world and refetches accordingly.
 */

export const TASKS_KEY = ['tasks'] as const;
export const HEALTH_KEY = ['health'] as const;

/** Roughly one Sepolia block. Polling faster would only re-read the same state. */
const BLOCK_TIME_MS = 12_000;

export function useTasks(): UseQueryResult<Task[], Error> {
  return useQuery({
    queryKey: TASKS_KEY,
    queryFn: getTasks,
    refetchInterval: BLOCK_TIME_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Doubles as the connection indicator: if this query fails the API is down or
 * misconfigured, which is worth saying plainly before the user tries to write.
 */
export function useHealth(): UseQueryResult<Health, Error> {
  return useQuery({
    queryKey: HEALTH_KEY,
    queryFn: getHealth,
    refetchInterval: 30_000,
    staleTime: 30_000,
  });
}
