/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // schema/mood-vector.ts lives at the repo root and is the contract the
    // site renders. Importing it beats keeping a second copy of the type here
    // that could quietly disagree with the pipeline.
    externalDir: true,
  },
};

export default nextConfig;
