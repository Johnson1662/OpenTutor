import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeSseHeaders } from './routes';
import type { SessionState } from '../state/session-state';

export function handleSseEvents(
  _req: IncomingMessage,
  res: ServerResponse,
  session: SessionState,
) {
  writeSseHeaders(res);
  session.listeners.add(res);

  res.write(`: connected\n\n`);

  res.on('close', () => {
    session.listeners.delete(res);
  });
}
