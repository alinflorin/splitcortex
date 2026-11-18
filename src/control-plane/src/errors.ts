export function isUniqueViolation(err: unknown): boolean {
  // Drizzle wraps the driver error in `cause`.
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/** Attaches the values for a translated message's `{{placeholders}}` to an error from `app.httpErrors`. */
export function withParams<E extends Error>(err: E, params: Record<string, string | number>): E {
  return Object.assign(err, { params });
}
