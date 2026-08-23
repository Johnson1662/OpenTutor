import http, { type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type {
  AcceptedResponse,
  AssessmentCompletedEventData,
  AgentCompletedEventData,
  AgentStartedEventData,
  KnowledgeUpdatedEventData,
  LearningEvent,
  LearningPathNode,
  LearningPathPatch,
  LearningSessionSnapshot,
  Lesson,
  LessonPatch,
  LessonPatchEventData,
  LessonUpdatedEventData,
  PathPatchEventData,
  RunTutorActionRequest,
  SubmitQuizAnswerRequest,
  TutorAction,
} from '@opentutor/protocol';

const PORT = Number(process.env.PORT ?? 8787);
const SESSION_ID = 'prototype';

type Listener = ServerResponse;

interface SessionState {
  lesson: Lesson;
  path: LearningPathNode[];
  pathVersion: number;
  seq: number;
  events: LearningEvent[];
  listeners: Set<Listener>;
}

function initialLesson(): Lesson {
  return {
    schemaVersion: '1.0',
    id: 'lesson-self-attention',
    courseId: 'transformer',
    knowledgeNodeId: 'self-attention',
    title: 'Self Attention',
    objective: 'Understand why a token needs information from other tokens.',
    version: 1,
    status: 'active',
    blocks: [
      {
        id: 'intro',
        type: 'text',
        variant: 'paragraph',
        content:
          'When you read a sentence, the meaning of one word often depends on other words around it. Self-attention gives each token a way to gather the context it needs.',
      },
      {
        id: 'definition',
        type: 'text',
        variant: 'definition',
        content:
          'Self-attention lets each token build a new representation by weighting information from tokens in the same sequence.',
      },
      {
        id: 'diagram',
        type: 'diagram',
        diagramType: 'relationship',
        nodes: [
          { id: 'animal', label: 'animal' },
          { id: 'was', label: 'was' },
          { id: 'tired', label: 'tired' },
        ],
        edges: [
          { from: 'animal', to: 'tired', label: '0.82' },
          { from: 'animal', to: 'was', label: '0.10' },
        ],
      },
      {
        id: 'quiz',
        type: 'quiz',
        answerType: 'text',
        question: 'Why might a token need information from another token?',
      },
    ],
  };
}

function initialPath(): LearningPathNode[] {
  return [
    { id: 'embedding', knowledgeNodeId: 'embedding', title: 'Embedding', type: 'main', status: 'completed', position: 0 },
    { id: 'self-attention', knowledgeNodeId: 'self-attention', title: 'Self Attention', type: 'main', status: 'current', position: 1 },
    { id: 'multi-head', knowledgeNodeId: 'multi-head', title: 'Multi-Head Attention', type: 'main', status: 'upcoming', position: 2 },
    { id: 'transformer-block', knowledgeNodeId: 'transformer-block', title: 'Transformer Block', type: 'main', status: 'upcoming', position: 3 },
    { id: 'gpt', knowledgeNodeId: 'gpt', title: 'GPT Architecture', type: 'main', status: 'upcoming', position: 4 },
  ];
}

const session: SessionState = {
  lesson: initialLesson(),
  path: initialPath(),
  pathVersion: 1,
  seq: 0,
  events: [],
  listeners: new Set(),
};

function findInsertIndex(ids: string[], position: { before: string } | { after: string } | { index: number }) {
  if ('index' in position) return Math.max(0, Math.min(position.index, ids.length));
  if ('before' in position) {
    const index = ids.indexOf(position.before);
    return index < 0 ? ids.length : index;
  }
  const index = ids.indexOf(position.after);
  return index < 0 ? ids.length : index + 1;
}

function applyLessonPatches(lesson: Lesson, patches: LessonPatch[], nextVersion: number): Lesson {
  let blocks = [...lesson.blocks];
  for (const patch of patches) {
    if (patch.op === 'insert') {
      const index = findInsertIndex(blocks.map((block) => block.id), patch.position);
      blocks.splice(index, 0, patch.block);
    } else if (patch.op === 'replace') {
      blocks = blocks.map((block) => (block.id === patch.blockId ? patch.block : block));
    } else if (patch.op === 'update') {
      blocks = blocks.map((block) => (block.id === patch.blockId ? ({ ...block, ...patch.changes } as typeof block) : block));
    } else if (patch.op === 'remove') {
      blocks = blocks.filter((block) => block.id !== patch.blockId);
    } else if (patch.op === 'move') {
      const currentIndex = blocks.findIndex((block) => block.id === patch.blockId);
      if (currentIndex >= 0) {
        const [block] = blocks.splice(currentIndex, 1);
        const index = findInsertIndex(blocks.map((candidate) => candidate.id), patch.position);
        blocks.splice(index, 0, block);
      }
    }
  }
  return { ...lesson, blocks, version: nextVersion };
}

function applyPathPatches(path: LearningPathNode[], patches: LearningPathPatch[]): LearningPathNode[] {
  let next = [...path];
  for (const patch of patches) {
    if (patch.op === 'insert_node') {
      if (next.some((node) => node.id === patch.node.id)) continue;
      const ids = next.map((node) => node.id);
      let index = next.length;
      if (patch.before) {
        const found = ids.indexOf(patch.before);
        index = found < 0 ? next.length : found;
      } else if (patch.after) {
        const found = ids.indexOf(patch.after);
        index = found < 0 ? next.length : found + 1;
      }
      next.splice(index, 0, patch.node);
    } else if (patch.op === 'update_node') {
      next = next.map((node) => (node.id === patch.nodeId ? { ...node, ...patch.changes } : node));
    } else if (patch.op === 'remove_node') {
      next = next.filter((node) => node.id !== patch.nodeId);
    }
  }
  return next.map((node, position) => ({ ...node, position }));
}

function encodeSse(event: LearningEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function publish<T>(type: LearningEvent['type'], data: T): LearningEvent<T> {
  const event: LearningEvent<T> = {
    id: randomUUID(),
    seq: ++session.seq,
    type,
    sessionId: SESSION_ID,
    timestamp: new Date().toISOString(),
    data,
  };
  session.events.push(event);
  if (session.events.length > 200) session.events.shift();
  const payload = encodeSse(event);
  for (const listener of session.listeners) listener.write(payload);
  return event;
}

function tutorResult(action: TutorAction): { message: string; lessonPatches: LessonPatch[]; pathPatches: LearningPathPatch[] } {
  if (action === 'simpler') {
    return {
      message: 'I simplified the explanation.',
      pathPatches: [],
      lessonPatches: [{
        op: 'replace',
        blockId: 'intro',
        block: {
          id: 'intro',
          type: 'text',
          variant: 'example',
          content:
            'Think of each token as a student in a group discussion. Before answering, each student looks at the others and decides whose information matters most. Self-attention is that “who should I listen to?” step.',
        },
      }],
    };
  }
  if (action === 'show_code') {
    return {
      message: 'I added a minimal code example.',
      pathPatches: [],
      lessonPatches: [{
        op: 'insert',
        position: { after: 'diagram' },
        block: {
          id: `code-${randomUUID()}`,
          type: 'code',
          language: 'python',
          code: 'scores = q @ k.T\nweights = softmax(scores)\noutput = weights @ v',
          explanation: 'This is the core computation before adding scaling, masking, batching, and multiple heads.',
        },
      }],
    };
  }
  if (action === 'visualize') {
    return {
      message: 'I added another relationship view.',
      pathPatches: [],
      lessonPatches: [{
        op: 'insert',
        position: { before: 'quiz' },
        block: {
          id: `diagram-${randomUUID()}`,
          type: 'diagram',
          diagramType: 'flow',
          nodes: [
            { id: 'q', label: 'Query' },
            { id: 'k', label: 'Keys' },
            { id: 'w', label: 'Weights' },
            { id: 'v', label: 'Values' },
          ],
          edges: [
            { from: 'q', to: 'k', label: 'compare' },
            { from: 'k', to: 'w', label: 'softmax' },
            { from: 'w', to: 'v', label: 'mix' },
          ],
        },
      }],
    };
  }
  return {
    message: "Let's fill the Softmax prerequisite first.",
    pathPatches: [{
      op: 'insert_node',
      after: 'self-attention',
      node: {
        id: 'softmax-detour',
        knowledgeNodeId: 'softmax',
        title: 'Softmax',
        type: 'detour',
        status: 'upcoming',
        position: 2,
        note: 'Quick detour added',
      },
    }],
    lessonPatches: [{
      op: 'insert',
      position: { before: 'quiz' },
      block: {
        id: `softmax-${randomUUID()}`,
        type: 'text',
        variant: 'callout',
        content:
          'Quick detour — Softmax turns arbitrary scores into positive weights that sum to 1, so attention can interpret them as “how much should I listen to each token?”.',
      },
    }],
  };
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function notFound(res: ServerResponse) {
  json(res, 404, { error: 'NOT_FOUND' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === `/api/sessions/${SESSION_ID}`) {
    const snapshot: LearningSessionSnapshot = {
      sessionId: SESSION_ID,
      lesson: session.lesson,
      path: session.path,
      pathVersion: session.pathVersion,
      lastSeq: session.seq,
    };
    return json(res, 200, snapshot);
  }

  if (req.method === 'GET' && url.pathname === `/api/sessions/${SESSION_ID}/events`) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');

    const lastEventId = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0);
    if (Number.isFinite(lastEventId) && lastEventId > 0) {
      for (const event of session.events.filter((candidate) => candidate.seq > lastEventId)) {
        res.write(encodeSse(event));
      }
    }

    session.listeners.add(res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      session.listeners.delete(res);
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === `/api/sessions/${SESSION_ID}/actions`) {
    const body = await readJson<RunTutorActionRequest>(req);
    const requestId = randomUUID();
    const accepted: AcceptedResponse = { accepted: true, requestId };
    json(res, 202, accepted);

    publish<AgentStartedEventData>('agent.started', { requestId, action: body.action });
    setTimeout(() => {
      const result = tutorResult(body.action);
      if (result.lessonPatches.length > 0) {
        const baseVersion = session.lesson.version;
        const version = baseVersion + 1;
        session.lesson = applyLessonPatches(session.lesson, result.lessonPatches, version);
        publish<LessonPatchEventData>('lesson.patch', {
          lessonId: session.lesson.id,
          baseVersion,
          version,
          patches: result.lessonPatches,
        });
      }
      if (result.pathPatches.length > 0) {
        const baseVersion = session.pathVersion;
        session.pathVersion += 1;
        session.path = applyPathPatches(session.path, result.pathPatches);
        publish<PathPatchEventData>('path.patch', {
          baseVersion,
          version: session.pathVersion,
          patches: result.pathPatches,
        });
      }
      publish<AgentCompletedEventData>('agent.completed', { requestId, message: result.message });
    }, 320);
    return;
  }

  if (req.method === 'POST' && url.pathname === `/api/lessons/${session.lesson.id}/blocks/quiz/answer`) {
    const body = await readJson<SubmitQuizAnswerRequest>(req);
    const requestId = randomUUID();
    json(res, 202, { accepted: true, requestId } satisfies AcceptedResponse);

    publish<AgentStartedEventData>('agent.started', { requestId });
    setTimeout(() => {
      const normalized = body.answer.toLowerCase();
      const correct = ['context', 'relation', 'other token', 'another token', 'depends'].some((keyword) => normalized.includes(keyword));

      publish<AssessmentCompletedEventData>('assessment.completed', {
        assessment: {
          id: randomUUID(),
          knowledgeNodeId: session.lesson.knowledgeNodeId,
          lessonId: session.lesson.id,
          blockId: 'quiz',
          result: correct ? 'correct' : 'partial',
          confidence: correct ? 0.86 : 0.55,
          feedback: correct
            ? 'Core idea understood. You recognized that a token may need context from other tokens.'
            : "Partially understood. Think about how one word's meaning can depend on another word.",
        },
      });

      if (correct && session.lesson.status !== 'completed') {
        const currentIndex = session.path.findIndex((node) => node.knowledgeNodeId === session.lesson.knowledgeNodeId);
        const pathPatches: LearningPathPatch[] = [];
        if (currentIndex >= 0) {
          pathPatches.push({ op: 'update_node', nodeId: session.path[currentIndex].id, changes: { status: 'completed' } });
          const nextMain = session.path.slice(currentIndex + 1).find((node) => node.type === 'main' && node.status === 'upcoming');
          if (nextMain) pathPatches.push({ op: 'update_node', nodeId: nextMain.id, changes: { status: 'current' } });
        }
        if (pathPatches.length > 0) {
          const baseVersion = session.pathVersion;
          session.pathVersion += 1;
          session.path = applyPathPatches(session.path, pathPatches);
          publish<PathPatchEventData>('path.patch', { baseVersion, version: session.pathVersion, patches: pathPatches });
        }

        session.lesson = { ...session.lesson, status: 'completed' };
        publish<LessonUpdatedEventData>('lesson.updated', {
          lessonId: session.lesson.id,
          version: session.lesson.version,
          changes: { status: 'completed' },
        });
        publish<KnowledgeUpdatedEventData>('knowledge.updated', {
          knowledgeNodeId: session.lesson.knowledgeNodeId,
          status: 'mastered',
          confidence: 0.86,
        });
      }

      publish<AgentCompletedEventData>('agent.completed', {
        requestId,
        message: correct ? 'Concept mastered.' : 'I added feedback to the quiz.',
      });
    }, 260);
    return;
  }

  if (req.method === 'POST' && url.pathname === `/api/sessions/${SESSION_ID}/reset`) {
    session.lesson = initialLesson();
    session.path = initialPath();
    session.pathVersion = 1;
    session.seq = 0;
    session.events = [];
    return json(res, 200, { ok: true });
  }

  notFound(res);
});

server.listen(PORT, () => {
  console.log(`OpenTutor prototype server listening on http://localhost:${PORT}`);
});
