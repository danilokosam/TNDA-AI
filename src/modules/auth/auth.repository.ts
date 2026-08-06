import { supabaseAdmin } from "@/config/supabase";
import { ConflictError, UnauthorizedError } from "@/utils/errors";
import type { ProfileRole } from "@/config/database.types";

export interface AuthUserRecord {
  id: string;
  email: string;
}

export async function createAuthUser(email: string, password: string): Promise<AuthUserRecord> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    if (error?.code === "email_exists") {
      throw new ConflictError("An account with this email already exists.");
    }
    throw new ConflictError(error?.message ?? "Unable to create the account.");
  }

  return { id: data.user.id, email: data.user.email ?? email };
}

export async function deleteAuthUser(userId: string): Promise<void> {
  await supabaseAdmin.auth.admin.deleteUser(userId);
}

export async function createOrganizationWithOwner(
  organizationName: string,
  owner: AuthUserRecord,
): Promise<{ organizationId: string; organizationName: string; role: ProfileRole }> {
  const { data: organization, error: organizationError } = await supabaseAdmin
    .from("organizations")
    .insert({ name: organizationName })
    .select("id, name")
    .single();

  if (organizationError || !organization) {
    throw new ConflictError(organizationError?.message ?? "Unable to create the organization.");
  }

  const { error: profileError } = await supabaseAdmin.from("profiles").insert({
    id: owner.id,
    organization_id: organization.id,
    email: owner.email,
    role: "owner",
  });

  if (profileError) {
    throw new ConflictError(profileError.message);
  }

  return { organizationId: organization.id, organizationName: organization.name, role: "owner" };
}

export interface ProfileWithOrganization {
  userId: string;
  email: string;
  role: ProfileRole;
  organizationId: string;
  organizationName: string;
}

export async function getProfileWithOrganization(userId: string): Promise<ProfileWithOrganization> {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, email, role, organization_id")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    throw new UnauthorizedError("No profile is associated with this account.");
  }

  const { data: organization, error: organizationError } = await supabaseAdmin
    .from("organizations")
    .select("id, name")
    .eq("id", profile.organization_id)
    .single();

  if (organizationError || !organization) {
    throw new UnauthorizedError("No organization is associated with this account.");
  }

  return {
    userId: profile.id,
    email: profile.email,
    role: profile.role,
    organizationId: organization.id,
    organizationName: organization.name,
  };
}

export interface PasswordSignInResult {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
}

export async function signInWithPassword(email: string, password: string): Promise<PasswordSignInResult> {
  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    throw new UnauthorizedError("Invalid email or password.");
  }

  return {
    userId: data.user.id,
    email: data.user.email ?? email,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at ?? null,
  };
}
