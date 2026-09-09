import type { MetadataRoute } from 'next'

/**
 * Item 7: installable PWA. Next's file-convention manifest route —
 * served at /manifest.webmanifest, referenced from app/layout.tsx's
 * metadata.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Rewind',
    short_name: 'Rewind',
    description: 'An offline-first, event-sourced task platform with full history and time travel.',
    start_url: '/',
    display: 'standalone',
    // rgb(), not hex — CLAUDE.md principle 6 is a blanket rule with no
    // exceptions (scripts/check-no-hex.mjs scans app/**/*.ts too), and
    // these two fields must be a literal CSS <color> string per the Web
    // App Manifest spec rather than a var() reference to our own tokens.
    background_color: 'rgb(252 252 252)',
    theme_color: 'rgb(252 252 252)',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}
