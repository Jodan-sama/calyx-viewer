import type { NextConfig } from "next";

// Default Next.js output — Vercel serves dynamic routes (/client/[slug])
// and client-rendered Supabase pages without pre-rendering. Do NOT re-add
// `output: "export"` unless every dynamic route can be pre-enumerated via
// generateStaticParams.
const nextConfig: NextConfig = {};

export default nextConfig;
