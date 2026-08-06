"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { apiFetch } from "@/lib/api/http";
import { authenticatedUserSchema, type LoginRequest, type SignUpRequest } from "@/types/api";

/**
 * Shape of *this app's own* `/api/auth/{login,signup}` Route Handler
 * response — deliberately not the backend's `AuthResponse`: the session
 * never reaches client code, only the user it belongs to.
 */
const authRouteResponseSchema = z.object({ user: authenticatedUserSchema });

export function useLogin() {
  const router = useRouter();

  return useMutation({
    mutationFn: (input: LoginRequest) =>
      apiFetch("/api/auth/login", authRouteResponseSchema, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      router.push("/dashboard");
    },
  });
}

export function useSignUp() {
  const router = useRouter();

  return useMutation({
    mutationFn: (input: SignUpRequest) =>
      apiFetch("/api/auth/signup", authRouteResponseSchema, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      router.push("/dashboard");
    },
  });
}

export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiFetch("/api/auth/logout", z.object({ success: z.boolean() }), { method: "POST" }),
    onSuccess: () => {
      // Clear the cache explicitly rather than relying on navigation alone
      // — it may hold the just-logged-out user's data, which shouldn't be
      // briefly visible if a different account logs in next in this tab.
      queryClient.clear();
      router.push("/login");
    },
  });
}
