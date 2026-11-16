export type LogLevel = 'info' | 'warn' | 'error';
export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  message: string;
}

const MAX = 500;

/**
 * In-memory ring buffer shown on the Logs screen. **Never log prompts, completions or key material**: messages here
 * describe state (connected, downloading, request started/finished with token counts), not content.
 */
export class LogBuffer {
  private entries: LogEntry[] = [];
  private listeners = new Set<() => void>();
  private nextId = 1;

  add(level: LogLevel, message: string) {
    this.entries = [
      ...this.entries.slice(-(MAX - 1)),
      { id: this.nextId++, time: Date.now(), level, message },
    ];
    this.listeners.forEach((l) => l());
  }
  info = (m: string) => this.add('info', m);
  warn = (m: string) => this.add('warn', m);
  error = (m: string) => this.add('error', m);

  clear() {
    this.entries = [];
    this.listeners.forEach((l) => l());
  }
  getSnapshot = () => this.entries;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  /** Plain text for sharing/copying. */
  toText() {
    return this.entries
      .map((e) => `${new Date(e.time).toISOString()} ${e.level.toUpperCase()} ${e.message}`)
      .join('\n');
  }
}
