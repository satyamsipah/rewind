import type { Metadata, Viewport } from 'next'
import { Providers } from '@/components/providers/providers'
import { THEME_ACCENT_VARS_CACHE_KEY, THEME_MODE_CACHE_KEY } from '@/lib/theme/storage-keys'
import './globals.css'

export const metadata: Metadata = {
  title: 'Rewind',
  description: 'An offline-first, event-sourced task platform with full history and time travel.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

/**
 * Runs before React hydrates and before first paint, so switching to a
 * saved dark/custom theme never flashes the default light theme first.
 * Reads the SAME localStorage cache lib/client/theme.ts writes
 * (lib/theme/storage-keys.ts) — duplicated here as literal strings
 * because an inline script can't import a module.
 */
const bootScript = `
(function () {
  try {
    var mode = localStorage.getItem('${THEME_MODE_CACHE_KEY}');
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-theme', mode);
    }
    var varsJson = localStorage.getItem('${THEME_ACCENT_VARS_CACHE_KEY}');
    if (varsJson) {
      var vars = JSON.parse(varsJson);
      var root = document.documentElement.style;
      for (var name in vars) root.setProperty(name, vars[name]);
    }
  } catch (e) {}
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inline and un-deferred on purpose: this must run synchronously,
            before first paint, to avoid a theme flash (see bootScript's
            own doc comment above). */}
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
