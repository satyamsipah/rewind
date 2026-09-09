import { NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * Typed error envelope for every API route (CLAUDE.md: "Every API route
 * validates input with Zod and returns typed errors"). `code` is a closed
 * union so a client can switch on it exhaustively instead of
 * string-matching a message.
 */
export const ApiErrorCode = z.enum([
  'unauthorized',
  'not_owner',
  'not_found',
  'validation_error',
  'batch_rejected',
  'rate_limited',
  'internal_error',
])
export type ApiErrorCode = z.infer<typeof ApiErrorCode>

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  not_owner: 403,
  not_found: 404,
  validation_error: 400,
  batch_rejected: 422,
  rate_limited: 429,
  internal_error: 500,
}

export function apiError(code: ApiErrorCode, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status: STATUS_BY_CODE[code] })
}
