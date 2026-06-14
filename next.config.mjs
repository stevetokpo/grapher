/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // duckdb and formidable are native / server-only — never bundle them for the client
  serverExternalPackages: ['duckdb', 'formidable'],
};

export default nextConfig;
