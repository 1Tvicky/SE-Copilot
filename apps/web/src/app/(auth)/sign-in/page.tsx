"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getProviders, signIn } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignInPage() {
  return (
    <React.Suspense fallback={null}>
      <SignInForm />
    </React.Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [oauthProviders, setOauthProviders] = React.useState<{ id: string; name: string }[]>([]);

  React.useEffect(() => {
    void getProviders().then((p) => setOauthProviders(Object.values(p ?? {}).filter((x) => x.type === "oauth")));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        toast.error(result.error === "CredentialsSignin" ? "Invalid email or password" : result.error);
        return;
      }
      router.push(searchParams.get("callbackUrl") ?? "/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Sign in to SE Copilot.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" className="text-xs text-muted-foreground hover:underline">
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
        {oauthProviders.length > 0 && (
          <>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>
            <div className="space-y-2">
              {oauthProviders.map((p) => (
                <Button
                  key={p.id}
                  variant="outline"
                  className="w-full"
                  onClick={() => signIn(p.id, { callbackUrl: searchParams.get("callbackUrl") ?? "/dashboard" })}
                >
                  Continue with {p.id === "azure-ad" ? "Microsoft" : p.name}
                </Button>
              ))}
            </div>
          </>
        )}
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        Don&apos;t have an account?&nbsp;
        <Link href="/sign-up" className="font-medium text-foreground hover:underline">
          Sign up
        </Link>
      </CardFooter>
    </Card>
  );
}
