"use client";

import { CircleAlert, LoaderCircle, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authRequired, signIn, useSignedIn } from "@/lib/auth";
import { Logo } from "./Logo";

/**
 * Shows the app once signed in (or when the server needs no password), otherwise the sign-in
 * screen. The app unmounts on sign-out or on any 401, which also stops its requests and streams.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const signedIn = useSignedIn();
  const [required, setRequired] = useState<boolean | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    authRequired()
      .then(setRequired)
      .catch(() => setUnreachable(true));
  }, []);

  // With a session in hand, render straight away: the first request refreshes the access token,
  // and a revoked session (e.g. the password changed) drops back here on its 401.
  if (signedIn || required === false) return children;
  if (unreachable) return <Screen title="Can't reach the API" description="Check that the backend is running, then reload." />;
  if (required === null)
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" aria-label="Loading" />
      </div>
    );
  return <SignIn />;
}

function Screen({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <main className="flex h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Logo size={28} />
            <span className="text-[16px] font-semibold tracking-[-0.02em]">{"Nodes Don't Lie"}</span>
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
      </Card>
    </main>
  );
}

function SignIn() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(password);
    } catch (err) {
      setError((err as Error).message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Sign in" description="Enter the access password to use Nodes Don't Lie.">
      <form onSubmit={submit} className="space-y-3">
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            aria-label="Password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error || undefined}
            className="h-9 pl-8"
          />
        </div>
        {error && (
          <Alert variant="destructive" className="py-2">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="h-9 w-full" disabled={busy || !password}>
          {busy && <LoaderCircle className="animate-spin" />}
          Sign in
        </Button>
      </form>
    </Screen>
  );
}
