import type { CourseRepository, CourseSourceRecord } from '@opentutor/database';
import type { IngestionService } from './ingestion-service.ts';
import type { DocumentLifecycleService, DocumentLifecycleResult } from './document-lifecycle.ts';

export interface DeleteSourceResult {
  detached: boolean;
  deletedDocument: boolean;
  lifecycleResult?: DocumentLifecycleResult;
}

export class CourseSourceService {
  private readonly courseRepo: CourseRepository;
  private readonly ingestionService: IngestionService;
  private readonly documentLifecycle: DocumentLifecycleService;

  constructor(
    courseRepo: CourseRepository,
    ingestionService: IngestionService,
    documentLifecycle: DocumentLifecycleService
  ) {
    this.courseRepo = courseRepo;
    this.ingestionService = ingestionService;
    this.documentLifecycle = documentLifecycle;
  }

  addSource(
    courseId: string,
    title: string,
    content: string
  ): CourseSourceRecord {
    const ingested = this.ingestionService.ingest({
      sourceUri: title,
      title,
      input: content,
    });

    this.courseRepo.attachCourseSource(courseId, ingested.documentId);

    return {
      id: ingested.documentId,
      courseId,
      documentId: ingested.documentId,
      title,
      content,
      version: ingested.version,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
  }

  listSources(courseId: string): CourseSourceRecord[] {
    return this.courseRepo.listCourseSources(courseId);
  }

  deleteSource(courseId: string, documentId: string): DeleteSourceResult {
    this.courseRepo.detachCourseSource(courseId, documentId);
    const refCount = this.courseRepo.countCourseSourceReferences(documentId);

    if (refCount === 0) {
      const lifecycleResult = this.documentLifecycle.deleteDocument(documentId);
      return { detached: true, deletedDocument: true, lifecycleResult };
    }

    return { detached: true, deletedDocument: false };
  }
}
