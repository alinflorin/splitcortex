import type { ChatMessage as WireMessage } from '../protocol/gen/splitcortex/node/v1/node_pb';
import type { ChatMessage, ContentPart } from './types';

/** The engine's form of a protocol message: plain text stays `content`, a message with media gets its `parts`. */
export function toChatMessage(m: WireMessage): ChatMessage {
  if (m.parts.length === 0) return { role: m.role, content: m.content };
  const parts: ContentPart[] = [];
  for (const p of m.parts) {
    const v = p.part;
    if (v.case === 'text') parts.push({ type: 'text', text: v.value });
    else if (v.case === 'image' || v.case === 'audio')
      parts.push({ type: v.case, mimeType: v.value.mimeType, data: v.value.data });
  }
  return { role: m.role, content: m.content, parts };
}
