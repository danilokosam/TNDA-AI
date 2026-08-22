import { can, type Permission } from "@tnda-ai/shared";
import type { ProfileRole } from "@/config/database.types";
import { ForbiddenError } from "@/utils/errors";

/**
 * The single call site pattern for "does this role have this permission?"
 * across the backend. Never compare `role === "..."` directly in a service
 * — call this (or assertPermissionOrOwner below) instead, so every
 * authorization rule is visible from one place: @tnda-ai/shared's
 * ROLE_PERMISSIONS. See docs/adr/0016-rbac-permission-model.md.
 */
export function assertPermission(auth: { role: ProfileRole }, permission: Permission): void {
  if (!can(auth.role, permission)) {
    throw new ForbiddenError(`This action requires the "${permission}" permission.`);
  }
}

/**
 * Like assertPermission, but with a resource-ownership escape hatch: the
 * action is also allowed if `isOwner` says the caller owns `resource`, even
 * without the permission. Ownership is deliberately kept as a separate,
 * per-call predicate rather than a generic ACL system — see the ADR for why.
 * Currently used only for document deletion; reuse this same primitive
 * (with a different `isOwner` predicate) for any future resource-level rule
 * rather than inventing a new mechanism.
 */
export function assertPermissionOrOwner<T>(
  auth: { role: ProfileRole; userId: string },
  permission: Permission,
  resource: T,
  isOwner: (resource: T, auth: { userId: string }) => boolean,
): void {
  if (can(auth.role, permission)) return;
  if (isOwner(resource, auth)) return;
  throw new ForbiddenError(
    `This action requires the "${permission}" permission, or ownership of the resource.`,
  );
}
