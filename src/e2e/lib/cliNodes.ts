import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createPrivateKey, sign } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseUrl } from './env';
import { cliNodeBinary } from './releases';

/** PKCS#8 prefix of an Ed25519 private key; the 32-byte seed follows. */
const ED25519_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');

/**
 * `Authorization` header of a device-API call (`/api/node/...`), signed with an Ed25519 seed exactly like the nodes do
 * (see control-plane `plugins/node-auth.ts`). `path` has no query; `skewSeconds` moves the timestamp for clock tests.
 */
export function nodeAuthHeader(
  seedHex: string,
  nodeId: string,
  method: string,
  path: string,
  skewSeconds = 0,
): string {
  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8, Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  });
  const ts = Math.floor(Date.now() / 1000) + skewSeconds;
  const message = Buffer.from(
    `splitcortex-node-request-v1\n${method.toUpperCase()}\n${path}\n${ts}`,
  );
  const signature = sign(null, message, key).toString('base64url');
  return `Node ${nodeId}.${ts}.${signature}`;
}

/** One released CLI node with a data directory of its own: several can run side by side in one test. */
export class CliNode {
  readonly home = mkdtempSync(join(tmpdir(), 'splitcortex-e2e-'));
  private proc: ChildProcess | undefined;

  private env() {
    return { ...process.env, SPLITCORTEX_HOME: this.home, SPLITCORTEX_URL: baseUrl() };
  }

  /** Enrolls with the code; throws when the node refuses (wrong, used or expired code). Does not start it. */
  async enroll(code: string): Promise<void> {
    const bin = await cliNodeBinary();
    execFileSync(bin, ['join', '--url', baseUrl(), '--code', code], {
      env: this.env(),
      stdio: 'pipe',
    });
  }

  /** The `join` output of a refused code, or null when it was accepted. */
  async tryEnroll(code: string): Promise<string | null> {
    try {
      await this.enroll(code);
      return null;
    } catch (e) {
      const err = e as { stderr?: Buffer; stdout?: Buffer; message: string };
      return `${err.stderr?.toString() ?? ''}${err.stdout?.toString() ?? ''}` || err.message;
    }
  }

  /** `splitcortex-node config ...` (settings the device keeps itself; an admin override wins). */
  async config(...args: string[]): Promise<void> {
    execFileSync(await cliNodeBinary(), ['config', ...args], { env: this.env(), stdio: 'pipe' });
  }

  async start(): Promise<void> {
    if (this.running()) return;
    this.proc = spawn(await cliNodeBinary(), ['run'], { env: this.env(), stdio: 'inherit' });
  }

  running(): boolean {
    return !!this.proc && this.proc.exitCode === null && this.proc.signalCode === null;
  }

  /** SIGTERM: the node finishes what it serves, then exits (graceful). Resolves when the process is gone. */
  async stop(timeoutMs = 60_000): Promise<void> {
    await this.end('SIGTERM', timeoutMs);
  }

  /** SIGKILL: the connection just dies, like a pulled plug. */
  async kill(): Promise<void> {
    await this.end('SIGKILL', 10_000);
  }

  private async end(signal: NodeJS.Signals, timeoutMs: number): Promise<void> {
    const p = this.proc;
    if (!p || !this.running()) return;
    const gone = new Promise<void>((resolve) => p.once('exit', () => resolve()));
    p.kill(signal);
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    await gone;
    clearTimeout(timer);
  }

  /** The process id while it runs (for SIGSTOP/SIGCONT in tests that freeze a device). */
  get pid(): number | undefined {
    return this.running() ? this.proc?.pid : undefined;
  }

  get nodeId(): string {
    return (
      JSON.parse(readFileSync(join(this.home, 'data', 'enrollment.json'), 'utf8')) as {
        nodeId: string;
      }
    ).nodeId;
  }

  /** The device's private seed (hex). Tests use it to call the device API like the node would. */
  get seedHex(): string {
    return readFileSync(join(this.home, 'data', 'secrets', 'device-key'), 'utf8').trim();
  }

  get enrolled(): boolean {
    return existsSync(join(this.home, 'data', 'enrollment.json'));
  }

  /** Stops the process and removes every trace. */
  async dispose(): Promise<void> {
    await this.kill();
    rmSync(this.home, { recursive: true, force: true });
  }
}
