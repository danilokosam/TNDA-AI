/**
 * The four system roles TNDA-AI currently supports. No custom/org-defined
 * roles yet — see docs/adr/0016-rbac-permission-model.md for why, and for
 * how to add a new role or permission later without restructuring this.
 */
export type Role = "member" | "reviewer" | "admin" | "owner";

export type Permission =
  | "documents.read"
  | "documents.upload"
  | "reports.read"
  | "documents.review"
  | "documents.edit"
  | "documents.approve"
  | "documents.delete"
  | "documents.export"
  | "organization.members.read"
  | "organization.members.manage"
  | "organization.settings.manage"
  | "billing.manage";

const MEMBER_PERMISSIONS: readonly Permission[] = ["documents.read", "documents.upload", "reports.read"];

const REVIEWER_PERMISSIONS: readonly Permission[] = [
  ...MEMBER_PERMISSIONS,
  "documents.review",
  "documents.edit",
  "documents.approve",
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...REVIEWER_PERMISSIONS,
  "documents.delete",
  "documents.export",
  "organization.members.read",
  "organization.members.manage",
  "organization.settings.manage",
];

const OWNER_PERMISSIONS: readonly Permission[] = [...ADMIN_PERMISSIONS, "billing.manage"];

/**
 * The single source of truth for what each role can do. Both backend and
 * frontend import this — never redefine it locally. To add a permission to
 * a role, add it here; to add a new role, add a new entry here and update
 * `Role` above. See docs/adr/0016-rbac-permission-model.md.
 */
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  member: new Set(MEMBER_PERMISSIONS),
  reviewer: new Set(REVIEWER_PERMISSIONS),
  admin: new Set(ADMIN_PERMISSIONS),
  owner: new Set(OWNER_PERMISSIONS),
};

/**
 * Pure, synchronous, no I/O — safe to call on every request with no caching
 * concern. Fails closed: a `role` that isn't a key in `ROLE_PERMISSIONS`
 * (e.g. a database enum value added without a matching update here) denies
 * the permission rather than throwing, so an authorization check degrades
 * to a clean 403 instead of a 500.
 */
export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
