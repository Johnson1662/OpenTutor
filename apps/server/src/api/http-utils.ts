import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LearningEvent } from '@opentutor/protocol';

export function resolveCorsOrigin(req?: IncomingMessage): string {
  const origin = req?.headers.origin;
  if (!origin) return '*';

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname;
    const isLocalhost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.localhost');

    if (isLocalhost) {
      return origin;
    }
  } catch {
    // Fall back to default
  }

  return '*';
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw) as T;
}

export function json(res: ServerResponse, status: number, body: unknown, req?: IncomingMessage) {
  const origin = resolveCorsOrigin(req);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': origin === '*' ? 'false' : 'true',
  });
  res.end(JSON.stringify(body));
}

export function notFound(res: ServerResponse, req?: IncomingMessage) {
  json(res, 404, { error: 'NOT_FOUND' }, req);
}

export function writeSseHeaders(res: ServerResponse, req?: IncomingMessage) {
  const origin = resolveCorsOrigin(req);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID',
    'Access-Control-Allow-Credentials': origin === '*' ? 'false' : 'true',
  });
  res.flushHeaders();
  res.write(': connected\n\n');
}

export function encodeSse(event: LearningEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
