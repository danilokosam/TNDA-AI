import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/utils/errors";
import { assertPermission, assertPermissionOrOwner } from "@/utils/authorization";

describe("assertPermission", () => {
  it("does not throw when the role has the permission", () => {
    expect(() => assertPermission({ role: "owner" }, "billing.manage")).not.toThrow();
  });

  it("throws ForbiddenError when the role lacks the permission", () => {
    expect(() => assertPermission({ role: "member" }, "billing.manage")).toThrow(ForbiddenError);
  });

  it("includes the permission name in the error message", () => {
    expect(() => assertPermission({ role: "member" }, "documents.export")).toThrow(/documents\.export/);
  });
});

describe("assertPermissionOrOwner", () => {
  const resource = { user_id: "user_1" };
  const isOwner = (r: { user_id: string }, auth: { userId: string }) => r.user_id === auth.userId;

  it("allows when the role has the permission, regardless of ownership", () => {
    expect(() =>
      assertPermissionOrOwner({ role: "admin", userId: "someone_else" }, "documents.delete", resource, isOwner),
    ).not.toThrow();
  });

  it("allows when the caller owns the resource, even without the permission", () => {
    expect(() =>
      assertPermissionOrOwner({ role: "member", userId: "user_1" }, "documents.delete", resource, isOwner),
    ).not.toThrow();
  });

  it("throws when the role lacks the permission and the caller does not own the resource", () => {
    expect(() =>
      assertPermissionOrOwner({ role: "member", userId: "someone_else" }, "documents.delete", resource, isOwner),
    ).toThrow(ForbiddenError);
  });

  it("throws when the role lacks the permission and the caller does not own the resource (reviewer)", () => {
    expect(() =>
      assertPermissionOrOwner({ role: "reviewer", userId: "someone_else" }, "documents.delete", resource, isOwner),
    ).toThrow(ForbiddenError);
  });
});
