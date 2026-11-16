const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 1536 -> "1.5 KB" (binary steps, shown with the usual KB/MB/GB labels). */
export function formatBytes(bytes: number, locale?: string): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${UNITS[unit]}`;
}
