"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useSignUp } from "@/features/auth/hooks";
import { signUpRequestSchema, type SignUpRequest } from "@/types/api";

export function SignUpForm() {
  const signUp = useSignUp();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpRequest>({ resolver: zodResolver(signUpRequestSchema) });

  return (
    <form onSubmit={handleSubmit((data) => signUp.mutate(data))} className="space-y-4">
      {signUp.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{signUp.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="organizationName">Organization name</Label>
        <Input id="organizationName" autoComplete="organization" {...register("organizationName")} />
        {errors.organizationName ? (
          <p className="text-sm text-destructive">{errors.organizationName.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
        {errors.email ? <p className="text-sm text-destructive">{errors.email.message}</p> : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
        {errors.password ? <p className="text-sm text-destructive">{errors.password.message}</p> : null}
      </div>

      <Button type="submit" className="w-full" disabled={signUp.isPending}>
        {signUp.isPending ? <Loader2 className="animate-spin" /> : null}
        Create account
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-primary underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
