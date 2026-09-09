import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Standard shadcn/ui helper: merges Tailwind classes, letting a later
 * conflicting utility (e.g. a caller's own `bg-*`) win over an earlier
 * one instead of both landing in the class list. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
