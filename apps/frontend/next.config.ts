import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't regenerate AGENTS.md/CLAUDE.md on every dev boot — not requested,
  // and this project already documents itself in README.md/PROGRESS.md.
  agentRules: false,
};

export default nextConfig;
