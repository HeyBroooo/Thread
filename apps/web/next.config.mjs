/** @type {import('next').NextConfig} */
const apiOrigin = (process.env.API_PROXY_TARGET ?? process.env.API_URL ?? 'http://localhost:8787').replace(/\/$/, '');

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
