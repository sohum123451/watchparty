/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@watchparty/shared', '@watchparty/client'],
};

export default nextConfig;
