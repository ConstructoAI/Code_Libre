/**
 * SEAOP React Frontend - API Response Unwrap Helper
 *
 * Backend endpoints return responses in one of several shapes:
 *   1. Bare value:      [{...}, {...}]  or  {field: value}
 *   2. Envelope:        {data: T, total?: N}
 *   3. Keyed envelope:  {items: [...], total: N, ...meta}
 *
 * `unwrap` extracts `.data` from shape (2) and passes shapes (1) and (3)
 * through unchanged. Callers that expect shape (3) read the keyed field
 * after unwrapping (handles future backends that might re-wrap in `data`).
 */

/**
 * Unwrap a `{data: T}` envelope. Returns `body.data` when present, else
 * the raw body. Falls back to `fallback` if the resolved value is nullish.
 *
 * Arrays are passed through (arrays have no `data` property).
 */
export function unwrap<T>(body: unknown, fallback: T): T {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    const inner = (body as { data: unknown }).data;
    return (inner ?? fallback) as T;
  }
  return (body ?? fallback) as T;
}
