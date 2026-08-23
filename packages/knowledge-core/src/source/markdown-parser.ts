import { randomUUID } from 'node:crypto';
import { computeSha256 } from './source-hash.ts';

export interface SourceChunk {
  id: string;
  ordinal: number;
  heading?: string;
  level: number;
  content: string;
  contentHash: string;
}

export function parseMarkdown(content: string): SourceChunk[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const chunks: SourceChunk[] = [];
  let heading: string | undefined;
  let level = 0;
  let body: string[] = [];

  const flush = () => {
    const text = body.join('\n').trim();
    if (text) {
      chunks.push({
        id: randomUUID(),
        ordinal: chunks.length,
        heading,
        level,
        content: text,
        contentHash: computeSha256(text),
      });
    }
    body = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      flush();
      level = match[1].length;
      heading = match[2].trim();
      continue;
    }
    body.push(line);
  }

  flush();
  return chunks;
}
