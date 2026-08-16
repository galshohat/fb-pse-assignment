/**
 * Scopes are the unit of authorization; roles are named bundles of them.
 *
 * Keeping roles as bundles rather than a parallel concept means every
 * authorization decision in the server is a scope check, and adding a role
 * never requires touching a tool.
 */
export const SCOPES = {
  /** Read the task list. Free — a view call spends no gas. */
  read: 'tasks:read',
  /** Add and complete tasks. Every use spends gas and is irreversible. */
  write: 'tasks:write',
  /** Manage credentials. Not needed to use the to-do list itself. */
  admin: 'tasks:admin',
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

export const ROLES = {
  viewer: [SCOPES.read],
  operator: [SCOPES.read, SCOPES.write],
  admin: [SCOPES.read, SCOPES.write, SCOPES.admin],
} as const satisfies Record<string, readonly Scope[]>;

export type Role = keyof typeof ROLES;

export const ROLE_NAMES = Object.keys(ROLES) as Role[];

export function isRole(value: string): value is Role {
  return value in ROLES;
}

export function scopesForRole(role: Role): Scope[] {
  return [...ROLES[role]];
}

export function hasScope(scopes: readonly string[], required: Scope): boolean {
  return scopes.includes(required);
}

/**
 * Explains a refusal in terms the caller can act on: which scope was needed
 * and what they actually hold. A refusal that does not say what is missing
 * leaves an operator guessing.
 */
export function describeMissingScope(required: Scope, held: readonly string[]): string {
  const holds = held.length > 0 ? held.join(', ') : 'no scopes';
  return `insufficient_scope: this operation requires "${required}" but your credential grants ${holds}. Ask for an operator credential to make changes.`;
}
