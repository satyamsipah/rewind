import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pins the workspace root to this repo — otherwise Next.js's file
  // tracer walks up and gets confused by an unrelated lockfile in a
  // parent directory outside this project.
  outputFileTracingRoot: path.join(__dirname),
}

export default nextConfig
