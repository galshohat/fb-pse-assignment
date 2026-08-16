---
name: contract
description: Facts about the deployed TodoList smart contract — its ABI, revert reasons, ID scheme, and the fact that the list is global and permissionless. Use when writing or reviewing any code that reads from or writes to the contract.
---

# The TodoList contract

Deployed at `0xdF52AD4b53a094B97cA4a056d7f51b82E3b795c8` on Ethereum Sepolia (chain ID
11155111). Source is verified on Sourcify (solc 0.8.34), so the behaviour below is exact, not
inferred.

## Interface

```solidity
struct Task { uint256 id; string description; bool completed; }

event TaskAdded(uint256 id, string description);   // both params non-indexed
event TaskCompleted(uint256 id);                    // non-indexed

function addTask(string memory _description) external;   // nonpayable, no return
function completeTask(uint256 _taskId) external;         // nonpayable, no return
function getTasks() external view returns (Task[] memory);
```

## Behaviour that the code must account for

**IDs are sequential from zero.** `nextTaskId` starts at 0 and increments on each add, so
`getTasks()[i].id == i` always holds, and a valid ID is any integer in `[0, taskCount)`.
Zero is a legitimate task ID — never treat it as falsy.

**Revert reasons** (validate against these _before_ sending a transaction, and still decode
them if a race slips through):

| Function       | Condition               | Revert string                 |
| -------------- | ----------------------- | ----------------------------- |
| `addTask`      | empty description       | `Description cannot be empty` |
| `completeTask` | `_taskId >= nextTaskId` | `Task does not exist`         |
| `completeTask` | task already completed  | `Task is already completed`   |

**The list is global and permissionless.** The contract has no owner and performs no
`msg.sender` checks. Every caller shares one list, anyone can complete anyone's task, and
other people's tasks will appear in `getTasks()`. Two consequences:

- Our authentication layer is the _only_ access control in the system. It protects the
  service and its gas, not the on-chain data — say so plainly in documentation rather than
  implying stronger guarantees.
- Any read is a snapshot. A task that exists and is pending when we check can be completed by
  someone else before our transaction lands, so a pre-flight check reduces wasted gas but
  never guarantees success. Handle the revert too.

**Events are non-indexed**, so logs cannot be filtered by task ID at the node; decode from
the data field if event data is ever needed.

**`getTasks` returns the entire array** in one call and has no pagination. Fine at demo scale;
worth noting as a scaling limit in architecture docs.
