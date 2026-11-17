import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

// The tiny chat model the inference suites serve: SmolLM2 135M Instruct (~143 MB, Apache-2.0, not gated), the smallest
// ready-made .litertlm in litert-community. Answers are poor on purpose; the tests only assert structure.
const FILE_NAME = 'SmolLM2_135M_Instruct.litertlm';
const URL_ = `https://huggingface.co/litert-community/SmolLM2-135M-Instruct/resolve/main/${FILE_NAME}`;

/** Where downloaded models are kept between runs (git-ignored; the workflow caches it). `E2E_MODEL_DIR` overrides. */
const dir = resolve(
  process.env.E2E_MODEL_DIR ??
    join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'models'),
);

/**
 * Path of the test model on disk. Reused when already there; otherwise downloaded on the spot (to a temporary name,
 * renamed when complete and the size matches, so an interrupted download is never mistaken for the file).
 */
export async function ensureModelFile(): Promise<{
  path: string;
  fileName: string;
  sizeBytes: number;
}> {
  const path = join(dir, FILE_NAME);
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true });
    const res = await fetch(URL_, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Downloading the test model failed: ${res.status}`);
    const expected = Number(res.headers.get('content-length'));
    const part = `${path}.${process.pid}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
      const size = statSync(part).size;
      if (!size || (expected && size !== expected))
        throw new Error(`The test model download is incomplete (${size} of ${expected} bytes)`);
      renameSync(part, path);
    } finally {
      await rm(part, { force: true });
    }
  }
  return { path, fileName: FILE_NAME, sizeBytes: statSync(path).size };
}
