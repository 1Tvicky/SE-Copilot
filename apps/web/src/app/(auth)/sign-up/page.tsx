"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { signUpSchema } from "@meeting-assistant/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errors, setErrors] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);

    const parsed = signUpSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/sign-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors(data.details?.formErrors?.[0] ? [data.details.formErrors[0]] : [data.error ?? "Sign up failed"]);
        return;
      }

      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        toast.success("Account created. Please sign in.");
        router.push("/sign-in");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Use your work email so you join your Solution Engineering team automatically.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              At least 10 characters, with an uppercase letter, a lowercase letter, and a digit.
            </p>
          </div>
          {errors.length > 0 && (
            <ul className="list-inside list-disc text-sm text-destructive">
              {errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating account..." : "Create account"}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Your organization may prefer Microsoft sign-in — use it from the sign-in page if it is offered.
        </p>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        Already have an account?&nbsp;
        <Link href="/sign-in" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
