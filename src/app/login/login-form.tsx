"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, SubmitButton } from "@/components/app/common";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/format";

const schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export function LoginForm({ next, authError }: { next: string; authError: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    authError ? "That sign-in link is invalid or has expired. Please try again." : null,
  );
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      setErrors({ email: f.email?.[0], password: f.password?.[0] });
      return;
    }
    setErrors({});
    setBusy(true);
    const supabase = createClient();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) throw error;
        toast.success("Welcome back!");
        router.replace(next);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          ...parsed.data,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
        });
        if (error) throw error;
        if (data.session) {
          toast.success("Account created. Welcome to Almie Bites!");
          router.replace("/dashboard");
          router.refresh();
        } else {
          setNotice("Check your email to confirm your account, then sign in.");
          setMode("signin");
        }
      }
    } catch (err) {
      const msg = errorMessage(err);
      if ((err as { code?: string }).code === "email_not_confirmed" || msg === "Email not confirmed") {
        setUnconfirmed(true);
        setNotice("Please confirm your email first — open the link Supabase sent you, then sign in.");
      }
      toast.error(msg === "Invalid login credentials" ? "Incorrect email or password." : msg);
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    setResending(true);
    const { error } = await createClient().auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
    });
    setResending(false);
    if (error) toast.error(errorMessage(error));
    else toast.success(`Confirmation email sent to ${email.trim()}. Check your inbox and spam folder.`);
  }

  return (
    <Card>
      <CardContent>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")} className="mb-4">
          <TabsList className="w-full">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Create account</TabsTrigger>
          </TabsList>
        </Tabs>
        {notice && (
          <p className="mb-4 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground" role="status">
            {notice}
          </p>
        )}
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label="Email" htmlFor="email" error={errors.email}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors.email}
            />
          </Field>
          <Field label="Password" htmlFor="password" error={errors.password}>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errors.password}
            />
          </Field>
          <SubmitButton busy={busy} size="lg" className="w-full">
            {mode === "signin" ? "Sign in" : "Create account"}
          </SubmitButton>
          {unconfirmed && (
            <Button type="button" variant="outline" className="w-full" onClick={resendConfirmation} disabled={resending || !email.trim()}>
              {resending ? "Sending…" : "Resend confirmation email"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
