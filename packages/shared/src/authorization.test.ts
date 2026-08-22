import { describe, expect, it } from "vitest";
import { can, ROLE_PERMISSIONS, type Permission, type Role } from "./authorization";

const ALL_PERMISSIONS: Permission[] = [
  "documents.read",
  "documents.upload",
  "reports.read",
  "documents.review",
  "documents.edit",
  "documents.approve",
  "documents.delete",
  "documents.export",
  "organization.members.read",
  "organization.members.manage",
  "organization.settings.manage",
  "billing.manage",
];

const EXPECTED: Record<Role, Permission[]> = {
  member: ["documents.read", "documents.upload", "reports.read"],
  reviewer: [
    "documents.read",
    "documents.upload",
    "reports.read",
    "documents.review",
    "documents.edit",
    "documents.approve",
  ],
  admin: [
    "documents.read",
    "documents.upload",
    "reports.read",
    "documents.review",
    "documents.edit",
    "documents.approve",
    "documents.delete",
    "documents.export",
    "organization.members.read",
    "organization.members.manage",
    "organization.settings.manage",
  ],
  owner: [
    "documents.read",
    "documents.upload",
    "reports.read",
    "documents.review",
    "documents.edit",
    "documents.approve",
    "documents.delete",
    "documents.export",
    "organization.members.read",
    "organization.members.manage",
    "organization.settings.manage",
    "billing.manage",
  ],
};

describe("can", () => {
  for (const role of Object.keys(EXPECTED) as Role[]) {
    for (const permission of ALL_PERMISSIONS) {
      const expected = EXPECTED[role].includes(permission);
      it(`${role} ${expected ? "has" : "does not have"} ${permission}`, () => {
        expect(can(role, permission)).toBe(expected);
      });
    }
  }
});

describe("ROLE_PERMISSIONS", () => {
  it("is strictly additive: reviewer ⊇ member, admin ⊇ reviewer, owner ⊇ admin", () => {
    for (const p of ROLE_PERMISSIONS.member) expect(ROLE_PERMISSIONS.reviewer.has(p)).toBe(true);
    for (const p of ROLE_PERMISSIONS.reviewer) expect(ROLE_PERMISSIONS.admin.has(p)).toBe(true);
    for (const p of ROLE_PERMISSIONS.admin) expect(ROLE_PERMISSIONS.owner.has(p)).toBe(true);
  });

  it("billing.manage belongs to owner only", () => {
    expect(ROLE_PERMISSIONS.member.has("billing.manage")).toBe(false);
    expect(ROLE_PERMISSIONS.reviewer.has("billing.manage")).toBe(false);
    expect(ROLE_PERMISSIONS.admin.has("billing.manage")).toBe(false);
    expect(ROLE_PERMISSIONS.owner.has("billing.manage")).toBe(true);
  });

  it("assigns every declared Permission to at least one role — a permission added to the union but never wired into ROLE_PERMISSIONS would otherwise typecheck while being silently unreachable by every role", () => {
    for (const permission of ALL_PERMISSIONS) {
      const assignedToSomeRole = Object.values(ROLE_PERMISSIONS).some((permissions) => permissions.has(permission));
      expect(assignedToSomeRole).toBe(true);
    }
  });
});

describe("can — unrecognized role", () => {
  it("fails closed (returns false) rather than throwing when the role isn't a key in ROLE_PERMISSIONS", () => {
    const unrecognizedRole = "bogus" as Role;
    expect(() => can(unrecognizedRole, "documents.read")).not.toThrow();
    expect(can(unrecognizedRole, "documents.read")).toBe(false);
  });
});
