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

export class EmptyPatchError extends Error {
  constructor(message: string = 'Cannot apply an empty patch list') {
    super(message);
    this.name = 'EmptyPatchError';
  }
}

export class DuplicateBlockIdError extends Error {
  readonly blockId: string;

  constructor(blockId: string) {
    super(`Cannot insert duplicate block ID '${blockId}'`);
    this.name = 'DuplicateBlockIdError';
    this.blockId = blockId;
  }
}

export class BlockNotFoundError extends Error {
  readonly blockId: string;

  constructor(blockId: string) {
    super(`Target block ID '${blockId}' was not found in the lesson`);
    this.name = 'BlockNotFoundError';
    this.blockId = blockId;
  }
}

export class TargetNotFoundError extends Error {
  readonly targetId: string;

  constructor(targetId: string) {
    super(`Positional target block ID '${targetId}' was not found in the lesson`);
    this.name = 'TargetNotFoundError';
    this.targetId = targetId;
  }
}

export class ImmutablePropertyError extends Error {
  readonly property: string;

  constructor(property: string) {
    super(`Cannot modify immutable property '${property}' via patch`);
    this.name = 'ImmutablePropertyError';
    this.property = property;
  }
}
