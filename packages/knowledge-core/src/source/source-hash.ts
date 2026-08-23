import { createHash } from 'node:crypto';

export function computeSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
