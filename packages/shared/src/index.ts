/**
 * Shared runtime-agnostic utilities and types for both applications.
 *
 * Originally scaffolded but left empty (see ADR 0008), this package is now
 * populated with the authorization model—the single source of truth for Role,
 * Permission types and the ROLE_PERMISSIONS mapping. This was the concrete need
 * that RBAC implementation provided, fulfilling the original intent to avoid
 * premature abstraction.
 */
export * from "./authorization";
