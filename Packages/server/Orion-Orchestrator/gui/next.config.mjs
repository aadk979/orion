/** @type {import('next').NextConfig} */
const nextConfig = {
    // Static export — AdminServer serves ./out same-origin next to /api/*.
    output: 'export',
    trailingSlash: true,
    images: { unoptimized: true }
};

export default nextConfig;
