import http from 'node:http';
import {
  createDatabase,
  seedDatabase,
  LessonRepository,
  SessionRepository,
  KnowledgeRepository,
  EventRepository,
} from '@opentutor/database';
import { EventBus } from './events/event-bus.ts';
import { SessionService } from './services/session-service.ts';
import { LessonService } from './services/lesson-service.ts';
import { KnowledgeService } from './services/knowledge-service.ts';
import { TutorService } from './services/tutor-service.ts';
import { DomainToolsExecutor } from '@opentutor/agent-tools';
import { TutorAgent } from '@opentutor/agent-runtime';
import { handleRequest, type RouteContext } from './api/routes.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.OPENTUTOR_DB_PATH ?? 'opentutor.sqlite';

export function createServerContext(dbPath: string = DB_PATH): {
  server: http.Server;
  context: RouteContext;
  close: () => Promise<void>;
} {
  const db = createDatabase(dbPath);
  seedDatabase(db);

  const lessonRepo = new LessonRepository(db);
  const sessionRepo = new SessionRepository(db);
  const knowledgeRepo = new KnowledgeRepository(db);
  const eventRepo = new EventRepository(db);

  const eventBus = new EventBus(eventRepo);
  const sessionService = new SessionService(sessionRepo, eventBus);
  const lessonService = new LessonService(lessonRepo, eventBus);
  const knowledgeService = new KnowledgeService(knowledgeRepo, eventBus);
  const tutorService = new TutorService(lessonService, sessionService, eventBus);

  const toolsExecutor = new DomainToolsExecutor({
    lessonService,
    sessionService,
    knowledgeService,
  });
  const tutorAgent = new TutorAgent(toolsExecutor);

  const context: RouteContext = {
    sessionService,
    lessonService,
    knowledgeService,
    tutorService,
    tutorAgent,
    eventBus,
  };

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, context);
    } catch (err) {
      console.error('Unhandled request error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR' }));
    }
  });

  return {
    server,
    context,
    close: () =>
      new Promise((resolve) => {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}

// Start server if run directly
if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  const { server } = createServerContext();
  server.listen(PORT, () => {
    console.log(`OpenTutor SQLite Server listening on http://localhost:${PORT}`);
  });
}
