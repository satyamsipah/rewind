import { wcagContrast } from 'culori'

/**
 * WCAG 2.x contrast — the literal legally-referenced "AA" standard
 * (relative luminance + contrast ratio), not the newer perceptual APCA
 * algorithm sometimes proposed for WCAG 3. The prompt says "WCAG AA
 * contrast", which means this exact formula; `culori.wcagContrast`
 * implements it (sRGB relative luminance, `(L1+0.05)/(L2+0.05)`), so this
 * module is a thin, explicit wrapper naming the actual AA thresholds
 * rather than scattering the magic numbers 4.5/3 across call sites.
 */
export const AA_NORMAL_TEXT = 4.5
export const AA_LARGE_TEXT = 3
/** Non-text UI component contrast — WCAG 1.4.11, same 3:1 threshold. */
export const AA_UI_COMPONENT = 3

export function contrastRatio(a: string, b: string): number {
  return wcagContrast(a, b)
}

export function meetsAA(a: string, b: string, threshold: number = AA_NORMAL_TEXT): boolean {
  return contrastRatio(a, b) >= threshold
}
