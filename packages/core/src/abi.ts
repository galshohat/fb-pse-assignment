/**
 * ABI of the deployed `TodoList` contract.
 *
 * Source: https://github.com/SlavaSereb/todo-contract-abi/blob/main/abi.json
 * The contract is verified on Sourcify (solc 0.8.34), so this matches the
 * deployed bytecode exactly rather than being reconstructed by hand.
 *
 * Declared `as const` so viem can infer argument and return types from it: a
 * typo in a function name or an argument of the wrong type fails to compile
 * instead of reverting on-chain.
 */
export const todoListAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: 'uint256', name: 'id', type: 'uint256' },
      { indexed: false, internalType: 'string', name: 'description', type: 'string' },
    ],
    name: 'TaskAdded',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [{ indexed: false, internalType: 'uint256', name: 'id', type: 'uint256' }],
    name: 'TaskCompleted',
    type: 'event',
  },
  {
    inputs: [{ internalType: 'string', name: '_description', type: 'string' }],
    name: 'addTask',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '_taskId', type: 'uint256' }],
    name: 'completeTask',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getTasks',
    outputs: [
      {
        components: [
          { internalType: 'uint256', name: 'id', type: 'uint256' },
          { internalType: 'string', name: 'description', type: 'string' },
          { internalType: 'bool', name: 'completed', type: 'bool' },
        ],
        internalType: 'struct TodoList.Task[]',
        name: '',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Revert strings the contract can produce. Kept next to the ABI because the
 * service validates against these conditions before spending gas, and maps
 * them back to typed errors when a race causes a revert anyway.
 */
export const CONTRACT_REVERTS = {
  emptyDescription: 'Description cannot be empty',
  taskNotFound: 'Task does not exist',
  alreadyCompleted: 'Task is already completed',
} as const;
