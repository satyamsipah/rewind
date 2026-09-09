/** Tailwind v4's PostCSS plugin — chosen over v3's JS config specifically
 * because v4's `@theme` lives in the SAME CSS file as the token
 * definitions themselves (app/globals.css), so there's one source of
 * truth instead of a CSS file and a JS config that have to be kept in
 * sync by hand. See docs/DECISIONS.md "Tailwind: v3 vs v4". */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
