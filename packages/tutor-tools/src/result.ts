export type TutorToolErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'VERSION_CONFLICT'
  | 'RETRIEVAL_BUDGET_EXCEEDED'
  | 'DOMAIN_CAPABILITY_UNAVAILABLE'
  | 'ARTIFACT_STALE'
  | 'INTERNAL_DOMAIN_ERROR';

export type TutorToolResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: { code: TutorToolErrorCode; message: string } };
