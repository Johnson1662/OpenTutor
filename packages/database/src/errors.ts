export class VersionConflictError extends Error {
  readonly entityId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(entityId: string, expectedVersion: number, actualVersion: number, message?: string) {
    super(
      message ??
      `Version conflict for entity '${entityId}': expected version ${expectedVersion}, but current version is ${actualVersion}`
    );
    this.name = 'VersionConflictError';
    this.entityId = entityId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
    Object.setPrototypeOf(this, VersionConflictError.prototype);
  }
}

export class NotFoundError extends Error {
  readonly entityType: string;
  readonly entityId: string;

  constructor(entityType: string, entityId: string, message?: string) {
    super(message ?? `${entityType} with ID '${entityId}' was not found`);
    this.name = 'NotFoundError';
    this.entityType = entityType;
    this.entityId = entityId;
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}
