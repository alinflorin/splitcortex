export function isUniqueViolation(err: unknown): boolean {
  // Drizzle wraps the driver error in `cause`.
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}
