/** @type {import('next').NextConfig} */
const apiOrigin = (process.env.API_PROXY_TARGET ?? process.env.API_URL ?? 'http://localhost:8787').replace(/\/$/, '');

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    const csp = ["default-src 'self'", "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''), "style-src 'self' 'unsafe-inline'", "img-src 'self' data: https:", "font-src 'self' data:", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
    return [{ source: '/:path*', headers: [
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'X-Frame-Options',value:'DENY'},
      {key:'Referrer-Policy',value:'no-referrer'},
      {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
      {key:'Content-Security-Policy',value:csp},
    ]}];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
