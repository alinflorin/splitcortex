import { describe, expect, it } from 'vitest';
import {
  AttachmentError,
  buildContent,
  encodeWav,
  kindOf,
  mediaBytes,
  toAttachment,
  type Attachment,
} from './attachments';

const file = (data: BlobPart, name: string, type: string) => new File([data], name, { type });

describe('kindOf', () => {
  it('sorts files by what the model can take', () => {
    expect(kindOf(file('x', 'a.png', 'image/png'))).toBe('image');
    expect(kindOf(file('x', 'a.webp', 'image/webp'))).toBe('image');
    expect(kindOf(file('x', 'a.wav', 'audio/wav'))).toBe('audio');
    expect(kindOf(file('x', 'rec', 'video/webm'))).toBe('audio');
    expect(kindOf(file('x', 'a.txt', 'text/plain'))).toBe('text');
    expect(kindOf(file('{}', 'a.json', 'application/json'))).toBe('text');
    expect(kindOf(file('x', 'main.rs', ''))).toBe('text'); // no mime type, known extension
    expect(kindOf(file('x', 'a.pdf', 'application/pdf'))).toBeNull();
    expect(kindOf(file('x', 'a.zip', 'application/zip'))).toBeNull();
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM header and clamps samples', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE');
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000); // byte rate: the gateway reads the clip length from it
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(40, true)).toBe(8);
    expect(wav.length).toBe(44 + 8);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([
      0, 32767, -32767, 32767,
    ]);
  });
});

describe('toAttachment', () => {
  it('reads a text file as text and refuses binary and unknown files', async () => {
    const a = await toAttachment(file('hello', 'notes.md', 'text/markdown'));
    expect(a).toMatchObject({ kind: 'text', name: 'notes.md', text: 'hello', size: 5 });
    await expect(toAttachment(file('a\u0000b', 'x.txt', 'text/plain'))).rejects.toMatchObject({
      code: 'unsupported',
    });
    await expect(toAttachment(file('x', 'a.pdf', 'application/pdf'))).rejects.toBeInstanceOf(
      AttachmentError,
    );
    await expect(
      toAttachment(file('x'.repeat(300 * 1024), 'big.txt', 'text/plain')),
    ).rejects.toMatchObject({ code: 'tooLarge' });
  });

  it('passes a small PNG through as a data URL', async () => {
    const a = await toAttachment(file(new Uint8Array([1, 2, 3]), 'p.png', 'image/png'));
    expect(a).toMatchObject({ kind: 'image', mime: 'image/png', size: 3 });
    expect(a.dataUrl).toBe('data:image/png;base64,AQID');
  });

  it('passes a WAV clip through', async () => {
    const a = await toAttachment(file(new Uint8Array([1, 2]), 'c.wav', 'audio/wav'));
    expect(a).toMatchObject({ kind: 'audio', mime: 'audio/wav', size: 2 });
  });
});

const att = (over: Partial<Attachment>): Attachment => ({
  id: 'a',
  kind: 'text',
  name: 'n',
  mime: 'text/plain',
  size: 1,
  ...over,
});

describe('buildContent', () => {
  it('stays a plain string without media, with files pasted in as text', () => {
    expect(buildContent('hi')).toBe('hi');
    expect(buildContent('read', [att({ name: 'a.txt', text: 'body' })])).toBe(
      'read\n\n[File: a.txt]\n```\nbody\n```',
    );
  });

  it('becomes OpenAI content parts with images and audio', () => {
    const parts = buildContent('what?', [
      att({ kind: 'image', mime: 'image/png', dataUrl: 'data:image/png;base64,AQID' }),
      att({ kind: 'audio', mime: 'audio/mpeg', dataUrl: 'data:audio/mpeg;base64,BAUG' }),
      att({ kind: 'audio', mime: 'audio/wav', dataUrl: 'data:audio/wav;base64,Bw==' }),
    ]);
    expect(parts).toEqual([
      { type: 'text', text: 'what?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
      { type: 'input_audio', input_audio: { data: 'BAUG', format: 'mp3' } },
      { type: 'input_audio', input_audio: { data: 'Bw==', format: 'wav' } },
    ]);
  });

  it('counts only media against the limit', () => {
    expect(mediaBytes([att({ size: 100 }), att({ kind: 'image', size: 7 })])).toBe(7);
  });
});
