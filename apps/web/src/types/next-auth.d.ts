import type { Role } from "@meeting-assistant/db";
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      name: string;
      email: string;
      image?: string | null;
    };
    /** Opaque per-sign-in id (hashed before storage) — lets a user identify "this device" in their sessions list. */
    sessionId?: string;
  }

  interface User {
    id: string;
    role: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    sessionId?: string;
    tokenVersion?: number;
    lastValidatedAt?: number;
    revoked?: boolean;
  }
}
