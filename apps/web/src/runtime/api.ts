import type {
  AcceptedResponse,
  LearningEvent,
  LearningSessionSnapshot,
  RunTutorActionRequest,
  SubmitQuizAnswerRequest,
  TutorAction,
} from '@opentutor/protocol';

export const PROTOTYPE_SESSION_ID = 'prototype';

export interface ProviderAuthMethod {
  available: boolean;
  label?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  modelCount?: number;
  auth?: {
    apiKey?: ProviderAuthMethod;
    oauth?: ProviderAuthMethod;
  };
}

export interface UserAiPreferences {
  userId: string;
  defaultProviderId?: string;
  defaultModelId?: string;
  thinkingLevel: string;
}

export interface CourseSummary {
  id: string;
  title: string;
  description?: string;
  compileStatus: 'draft' | 'compiling' | 'ready' | 'failed' | 'active' | 'archived';
  compiledAt?: string;
  createdAt: string;
}

export interface CourseSourceItem {
  id: string;
  documentId: string;
  title: string;
  content: string;
  version: number;
  status: string;
  createdAt: string;
}

export interface CourseMapInfo {
  courseId: string;
  title: string;
  nodes: Array<{
    knowledgeNodeId: string;
    title: string;
    position: number;
    description?: string;
  }>;
  edges: Array<{
    fromNodeId: string;
    toNodeId: string;
    relationType: string;
  }>;
}

// 1. AI & Settings APIs
export async function listProviders(): Promise<ProviderInfo[]> {
  const res = await fetch('/api/ai/providers');
  if (!res.ok) throw new Error('Failed to fetch AI providers');
  return res.json();
}

export async function listProviderModels(providerId: string): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`/api/ai/providers/${providerId}/models`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.models ?? [];
}

export async function loginWithApiKey(providerId: string, apiKey: string): Promise<void> {
  const res = await fetch('/api/ai/auth/login-api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, apiKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Failed to login with API key');
  }
}

export async function getAiPreferences(): Promise<UserAiPreferences> {
  const res = await fetch('/api/ai/preferences');
  if (!res.ok) throw new Error('Failed to fetch AI preferences');
  return res.json();
}

export async function updateAiPreferences(prefs: Partial<UserAiPreferences>): Promise<UserAiPreferences> {
  const res = await fetch('/api/ai/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error('Failed to update AI preferences');
  return res.json();
}

export async function startAuthSession(providerId: string, type: string = 'api_key'): Promise<{ authSessionId: string }> {
  const res = await fetch('/api/ai/auth/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, type }),
  });
  if (!res.ok) throw new Error('Failed to start auth session');
  return res.json();
}

export async function cancelAuthSession(sessionId: string): Promise<void> {
  await fetch(`/api/ai/auth/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function respondAuthSession(
  sessionId: string,
  promptId: string,
  response: string
): Promise<void> {
  const res = await fetch(`/api/ai/auth/sessions/${sessionId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ promptId, response }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Failed to respond to auth session');
  }
}

export interface AuthUrlEventData {
  url: string;
}

export interface AuthDeviceCodeEventData {
  userCode: string;
  verificationUri?: string;
}

export interface AuthPromptEventData {
  promptId: string;
  promptType?: string;
  message: string;
  placeholder?: string;
}

export interface AuthProgressEventData {
  message: string;
}

export interface AuthFailedEventData {
  error: string;
}

export interface AuthEventPayload {
  type: string;
  data: unknown;
}

export function subscribeToAuthEvents(
  sessionId: string,
  onEvent: (event: AuthEventPayload) => void,
  onError?: (err: Event) => void
): () => void {
  const eventSource = new EventSource(`/api/ai/auth/sessions/${sessionId}/events`);

  const eventTypes = [
    'auth.url',
    'auth.device_code',
    'auth.prompt',
    'auth.progress',
    'auth.completed',
    'auth.failed',
    'auth.cancelled',
  ];

  for (const type of eventTypes) {
    eventSource.addEventListener(type, (e: MessageEvent) => {
      try {
        const data = e.data ? (JSON.parse(e.data) as unknown) : {};
        onEvent({ type, data });
      } catch {
        onEvent({ type, data: e.data });
      }
    });
  }

  eventSource.onerror = (err) => {
    onError?.(err);
  };

  return () => {
    eventSource.close();
  };
}

// 2. Course APIs
export async function listCourses(): Promise<CourseSummary[]> {
  const res = await fetch('/api/courses');
  if (!res.ok) throw new Error('Failed to fetch courses');
  const data = await res.json();
  return data.courses ?? [];
}

export async function getCourse(id: string): Promise<CourseSummary> {
  const res = await fetch(`/api/courses/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch course ${id}`);
  const data = await res.json();
  return data.course;
}

export async function createCourse(title: string, description?: string): Promise<CourseSummary> {
  const res = await fetch('/api/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description }),
  });
  if (!res.ok) throw new Error('Failed to create course');
  const data = await res.json();
  return data.course;
}

export async function addCourseSource(courseId: string, title: string, content: string): Promise<CourseSourceItem> {
  const res = await fetch(`/api/courses/${courseId}/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  });
  if (!res.ok) throw new Error('Failed to upload material');
  const data = await res.json();
  return data.source;
}

export async function listCourseSources(courseId: string): Promise<CourseSourceItem[]> {
  const res = await fetch(`/api/courses/${courseId}/sources`);
  if (!res.ok) throw new Error('Failed to fetch course materials');
  const data = await res.json();
  return data.sources ?? [];
}

export async function deleteCourseSource(courseId: string, sourceId: string): Promise<void> {
  const res = await fetch(`/api/courses/${courseId}/sources/${sourceId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete material');
}

export async function compileCourse(courseId: string, learningGoal: string): Promise<{ course: CourseSummary; snapshot: LearningSessionSnapshot }> {
  const res = await fetch(`/api/courses/${courseId}/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ learningGoal }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Compilation failed');
  }
  return res.json();
}

export async function getCourseMap(courseId: string): Promise<CourseMapInfo> {
  const res = await fetch(`/api/courses/${courseId}/map`);
  if (!res.ok) throw new Error('Failed to fetch course map');
  const data = await res.json();
  return data.map;
}

// 3. Learning Room & Session APIs
export async function getSession(sessionId: string = PROTOTYPE_SESSION_ID): Promise<LearningSessionSnapshot> {
  const response = await fetch(`/api/sessions/${sessionId}`);
  if (!response.ok) throw new Error(`Failed to load session: ${response.status}`);
  return response.json();
}

export async function getPrototypeSession(): Promise<LearningSessionSnapshot> {
  return getSession(PROTOTYPE_SESSION_ID);
}

export async function runTutorAction(action: TutorAction, sessionId: string = PROTOTYPE_SESSION_ID): Promise<AcceptedResponse> {
  const body: RunTutorActionRequest = { action };
  const response = await fetch(`/api/sessions/${sessionId}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Tutor action failed: ${response.status}`);
  return response.json();
}

export async function submitQuizAnswer(
  lessonId: string,
  blockId: string,
  answer: string,
  sessionId: string = PROTOTYPE_SESSION_ID
): Promise<AcceptedResponse> {
  const body: SubmitQuizAnswerRequest = { answer };
  const response = await fetch(`/api/lessons/${lessonId}/blocks/${blockId}/answer?sessionId=${sessionId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Quiz submission failed: ${response.status}`);
  return response.json();
}

export async function sendTutorMessage(message: string, sessionId: string = PROTOTYPE_SESSION_ID): Promise<AcceptedResponse> {
  const response = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) throw new Error(`Message failed: ${response.status}`);
  return response.json();
}

export function subscribeToLearningEvents(
  sessionId: string = PROTOTYPE_SESSION_ID,
  afterSeq: number,
  onEvent: (event: LearningEvent) => void,
  onConnectionChange?: (connected: boolean) => void,
) {
  const source = new EventSource(`/api/sessions/${sessionId}/events?lastSeq=${afterSeq}`);
  source.onopen = () => onConnectionChange?.(true);
  source.onerror = () => onConnectionChange?.(false);

  const types = [
    'agent.started',
    'agent.text.delta',
    'agent.tool.started',
    'agent.tool.completed',
    'agent.completed',
    'lesson.patch',
    'lesson.updated',
    'path.patch',
    'assessment.completed',
    'knowledge.updated',
    'error',
  ] as const;

  for (const type of types) {
    source.addEventListener(type, (raw) => {
      const message = raw as MessageEvent<string>;
      onEvent(JSON.parse(message.data) as LearningEvent);
    });
  }

  return () => source.close();
}
