import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// This is an npm-workspaces monorepo: `next dev`/`next build` run with this
// package's directory as cwd, so Next's automatic .env loading never sees
// the shared .env at the repo root. Load it explicitly before anything else
// reads process.env. In Docker, env vars come from docker-compose's
// `env_file` instead, so this is a no-op there (dotenv never overrides
// variables that are already set).
loadEnv({ path: path.resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
};

export default nextConfig;
