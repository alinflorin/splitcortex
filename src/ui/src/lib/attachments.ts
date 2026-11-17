import type { ContentPart } from './chatStream';

/**
 * Files the Playground can send along with a message. Images and audio go to the model as they are (re-encoded when
 * the format is not one the gateway takes, or when they are big); text files are pasted into the message as text.
 * Everything stays in this tab's memory, like the conversation.
 */
export type AttachmentKind = 'image' | 'audio' | 'text';

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  /** Bytes of the data that is sent (the file's text for `text`). */
  size: number;
  /** `data:<mime>;base64,...` of an image or audio clip: what is sent and what the page shows. */
  dataUrl?: string;
  /** The content of a text file. */
  text?: string;
}

export type AttachmentErrorCode = 'unsupported' | 'tooLarge' | 'unreadable' | 'tooLong';

/** `detail` fills the message (the limit, for `tooLarge`). */
export class AttachmentError extends Error {
  constructor(
    readonly code: AttachmentErrorCode,
    readonly file: string,
    readonly detail = '',
  ) {
    super(`${code}: ${file}`);
  }
}

/** The gateway's default limit on the media of one request; it reports its real one with `/v1/models`. */
export const DEFAULT_MAX_MEDIA_BYTES = 256 * 1024 * 1024;
export const MAX_TEXT_BYTES = 200 * 1024;
/** Images up to this size in a format the gateway takes are sent untouched; others are re-encoded. */
const IMAGE_PASSTHROUGH_BYTES = 1024 * 1024;
const IMAGE_MAX_SIDE = 1024;
const AUDIO_PASSTHROUGH_BYTES = 5 * 1024 * 1024;
/** What the gateway takes; the speech models want 16 kHz mono. */
const AUDIO_RATE = 16000;
const MAX_AUDIO_SECONDS = 10 * 60;

const GATEWAY_IMAGES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/bmp']);
const GATEWAY_AUDIO = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
  'audio/flac',
]);
const TEXT_EXTENSIONS = new Set(
  (
    'txt md markdown csv tsv json jsonl yaml yml toml ini cfg conf env log xml html htm css scss js mjs cjs ts tsx jsx ' +
    'py rb php java kt kts swift go rs c h cc cpp hpp cs sh bash zsh fish ps1 bat sql graphql proto tex rst srt vtt diff patch'
  ).split(' '),
);
const TEXT_MIMES =
  /^(text\/|application\/(json|xml|x-yaml|yaml|toml|x-sh|javascript|typescript|sql))/;

let counter = 0;
const nextId = () => `att-${Date.now()}-${counter++}`;

export function kindOf(file: File): AttachmentKind | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/') || file.type === 'video/webm' || file.type === 'video/ogg')
    return 'audio'; // a recording in a video container
  if (TEXT_MIMES.test(file.type)) return 'text';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return file.type === '' || file.type === 'application/octet-stream'
    ? TEXT_EXTENSIONS.has(ext)
      ? 'text'
      : null
    : null;
}

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const decodedSize = (dataUrl: string) => {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
};

/** A 16-bit PCM mono WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  tag(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) =>
    v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true),
  );
  return out;
}

/** Any audio the browser can decode, as 16 kHz mono WAV. */
async function toWav(file: Blob, name: string): Promise<Blob> {
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC || typeof OfflineAudioContext === 'undefined')
    throw new AttachmentError('unreadable', name);
  const ctx = new AC();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > MAX_AUDIO_SECONDS) throw new AttachmentError('tooLong', name);
    const off = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(decoded.duration * AUDIO_RATE)),
      AUDIO_RATE,
    );
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return new Blob([encodeWav(rendered.getChannelData(0), AUDIO_RATE) as BlobPart], {
      type: 'audio/wav',
    });
  } catch (e) {
    throw e instanceof AttachmentError ? e : new AttachmentError('unreadable', name);
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

/** Scales an image down and re-encodes it as JPEG. */
async function shrinkImage(file: Blob, name: string): Promise<Blob> {
  if (typeof createImageBitmap === 'undefined') throw new AttachmentError('unreadable', name);
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const g = canvas.getContext('2d');
    if (!g) throw new Error('no canvas');
    g.fillStyle = '#fff'; // JPEG has no transparency
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!out) throw new Error('no blob');
    return out;
  } catch {
    throw new AttachmentError('unreadable', name);
  }
}

/** Turns a picked or recorded file into something the Playground can show and send. Throws `AttachmentError`. */
export async function toAttachment(
  file: File,
  maxMediaBytes = DEFAULT_MAX_MEDIA_BYTES,
): Promise<Attachment> {
  const kind = kindOf(file);
  if (!kind) throw new AttachmentError('unsupported', file.name);

  if (kind === 'text') {
    if (file.size > MAX_TEXT_BYTES)
      throw new AttachmentError('tooLarge', file.name, `${MAX_TEXT_BYTES / 1024} KiB`);
    const text = await file.text();
    if (text.includes('\u0000')) throw new AttachmentError('unsupported', file.name); // binary
    return {
      id: nextId(),
      kind,
      name: file.name,
      mime: file.type || 'text/plain',
      size: file.size,
      text,
    };
  }

  let blob: Blob = file;
  if (kind === 'image') {
    if (!GATEWAY_IMAGES.has(file.type) || file.size > IMAGE_PASSTHROUGH_BYTES)
      blob = await shrinkImage(file, file.name);
  } else if (!GATEWAY_AUDIO.has(file.type) || file.size > AUDIO_PASSTHROUGH_BYTES) {
    blob = await toWav(file, file.name);
  }
  if (blob.size > maxMediaBytes)
    throw new AttachmentError(
      'tooLarge',
      file.name,
      `${Math.round(maxMediaBytes / 1024 / 1024)} MiB`,
    );
  const dataUrl = await readAsDataUrl(blob);
  return {
    id: nextId(),
    kind,
    name: file.name,
    mime: blob.type || file.type,
    size: decodedSize(dataUrl),
    dataUrl,
  };
}

/** Bytes of media in `attachments` (what counts against the gateway's per-request limit). */
export const mediaBytes = (attachments: readonly Attachment[]) =>
  attachments.reduce((n, a) => (a.kind === 'text' ? n : n + a.size), 0);

const audioFormat = (mime: string) =>
  mime === 'audio/mpeg' ? 'mp3' : mime === 'audio/flac' ? 'flac' : 'wav';

/**
 * The message content for the gateway: plain text when there is no media (so every model and older gateway keeps
 * working), else OpenAI content parts. Text files are pasted into the text as fenced blocks.
 */
export function buildContent(
  text: string,
  attachments: readonly Attachment[] = [],
): string | ContentPart[] {
  const files = attachments
    .filter((a) => a.kind === 'text')
    .map((a) => `\n\n[File: ${a.name}]\n\`\`\`\n${a.text ?? ''}\n\`\`\``)
    .join('');
  const body = `${text}${files}`.trim();
  const media = attachments.filter((a) => a.kind !== 'text' && a.dataUrl);
  if (media.length === 0) return body;
  const parts: ContentPart[] = [];
  if (body) parts.push({ type: 'text', text: body });
  for (const a of media) {
    const url = a.dataUrl ?? '';
    parts.push(
      a.kind === 'image'
        ? { type: 'image_url', image_url: { url } }
        : {
            type: 'input_audio',
            input_audio: { data: url.slice(url.indexOf(',') + 1), format: audioFormat(a.mime) },
          },
    );
  }
  return parts;
}

/** Records the microphone until `stop()`; resolves with the recording as a file. */
export async function startRecording(): Promise<{ stop: () => Promise<File>; cancel: () => void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const release = () => stream.getTracks().forEach((t) => t.stop());
  rec.start();
  return {
    stop: () =>
      new Promise<File>((resolve) => {
        rec.onstop = () => {
          release();
          const type = rec.mimeType || 'audio/webm';
          resolve(new File(chunks, 'recording', { type }));
        };
        rec.stop();
      }),
    cancel: () => {
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      release();
    },
  };
}
