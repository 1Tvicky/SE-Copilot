"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forgot your password?</CardTitle>
        <CardDescription>We&apos;ll email you a link to reset it.</CardDescription>
      </CardHeader>
      <CardContent>
        {submitted ? (
          <p className="text-sm text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{email}</span>, a reset link is
            on its way.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending..." : "Send reset link"}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        <Link href="/sign-in" className="hover:underline">
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
