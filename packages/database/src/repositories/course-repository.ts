import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface CourseRecord {
 id: string;
 title: string;
 description?: string;
 compileStatus: 'draft' | 'compiling' | 'ready' | 'failed' | 'active' | 'archived';
 compiledAt?: string;
 compileError?: string;
 createdAt: string;
  language?: 'zh' | 'en';
}

export interface CourseSourceRecord {
 id: string;
 courseId: string;
 documentId: string;
 title: string;
 content: string;
 version: number;
 status: 'active' | 'superseded' | 'deleted';
 createdAt: string;
}

export interface CourseMapData {
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

export interface CourseEvidenceItem {
 claimId: string;
 knowledgeNodeId: string;
 statement: string;
 status: string;
 claimConfidence: number;
 evidenceId: string;
 excerpt: string;
 relation: string;
 evidenceConfidence: number;
 sourceTitle: string;
}

export class CourseRepository {
 private readonly db: Database.Database;

 constructor(db: Database.Database) {
  this.db = db;
 }

 createCourse(course: {
  id: string;
  title: string;
  description?: string;
  compileStatus?: CourseRecord['compileStatus'];
  language?: 'zh' | 'en';
 }): CourseRecord {
  const now = new Date().toISOString();
  const status = course.compileStatus ?? 'draft';
  const language = course.language ?? 'zh';

  this.db
   .prepare(
    `INSERT INTO courses (id, title, description, compile_status, language, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           compile_status = excluded.compile_status,
           language = excluded.language`
   )
   .run(course.id, course.title, course.description ?? '', status, language, now);

  return this.getCourse(course.id)!;
 }

 getCourse(id: string): CourseRecord | null {
  const row = this.db
   .prepare(
    'SELECT id, title, description, compile_status, compiled_at, compile_error, created_at, language FROM courses WHERE id = ?'
   )
   .get(id) as any;

  if (!row) return null;
  return {
   id: row.id,
   title: row.title,
   description: row.description ?? undefined,
   compileStatus: row.compile_status ?? 'ready',
   compiledAt: row.compiled_at ?? undefined,
   compileError: row.compile_error ?? undefined,
   createdAt: row.created_at,
   language: (row.language as 'zh' | 'en') ?? 'zh',
  };
 }

 listCourses(): CourseRecord[] {
  const rows = this.db
   .prepare(
    'SELECT id, title, description, compile_status, compiled_at, compile_error, created_at, language FROM courses ORDER BY created_at DESC'
   )
   .all() as any[];

  return rows.map((row) => ({
   id: row.id,
   title: row.title,
   description: row.description ?? undefined,
   compileStatus: row.compile_status ?? 'ready',
   compiledAt: row.compiled_at ?? undefined,
   compileError: row.compile_error ?? undefined,
   createdAt: row.created_at,
   language: (row.language as 'zh' | 'en') ?? 'zh',
  }));
 }

 updateCourse(
  id: string,
  changes: Partial<Pick<CourseRecord, 'title' | 'description' | 'compileStatus' | 'compiledAt' | 'compileError'>>
 ): CourseRecord | null {
  const existing = this.getCourse(id);
  if (!existing) return null;

  const title = changes.title ?? existing.title;
  const description = changes.description !== undefined ? changes.description : existing.description;
  const compileStatus = changes.compileStatus ?? existing.compileStatus;
  const compiledAt = changes.compiledAt !== undefined ? changes.compiledAt : existing.compiledAt;
  const compileError = changes.compileError !== undefined ? changes.compileError : existing.compileError;

  this.db
   .prepare(
    `UPDATE courses
         SET title = ?, description = ?, compile_status = ?, compiled_at = ?, compile_error = ?
         WHERE id = ?`
   )
   .run(title, description ?? null, compileStatus, compiledAt ?? null, compileError ?? null, id);

  return this.getCourse(id);
 }

 attachCourseSource(courseId: string, documentId: string): void {
  const now = new Date().toISOString();
  this.db
   .prepare(
    `INSERT INTO course_sources (course_id, document_id, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(course_id, document_id) DO NOTHING`
   )
   .run(courseId, documentId, now);
 }

 detachCourseSource(courseId: string, documentId: string): boolean {
  const info = this.db
   .prepare('DELETE FROM course_sources WHERE course_id = ? AND document_id = ?')
   .run(courseId, documentId);
  return info.changes > 0;
 }

 countCourseSourceReferences(documentId: string): number {
  const row = this.db
   .prepare('SELECT COUNT(*) as count FROM course_sources WHERE document_id = ?')
   .get(documentId) as { count: number } | undefined;
  return row?.count ?? 0;
 }

 listCourseSources(courseId: string): CourseSourceRecord[] {
  const rows = this.db
   .prepare(
    `SELECT d.id, d.title, dv.content, dv.version, dv.status, dv.created_at
         FROM documents d
         JOIN course_sources cs ON cs.document_id = d.id
         JOIN document_versions dv ON dv.document_id = d.id
         WHERE cs.course_id = ? AND dv.status = 'active'
         ORDER BY dv.created_at ASC`
   )
   .all(courseId) as any[];

  return rows.map((r) => ({
   id: r.id,
   courseId,
   documentId: r.id,
   title: r.title,
   content: r.content,
   version: r.version,
   status: r.status,
   createdAt: r.created_at,
  }));
 }

 deleteCourseSource(courseId: string, documentId: string): boolean {
  return this.detachCourseSource(courseId, documentId);
 }

 getCourseMap(courseId: string): CourseMapData {
  const course = this.getCourse(courseId);
  const title = course?.title ?? courseId;

  const nodeRows = this.db
   .prepare(
    `SELECT cn.knowledge_node_id, cn.position, kn.title, kn.description
         FROM course_nodes cn
         JOIN knowledge_nodes kn ON kn.id = cn.knowledge_node_id
         WHERE cn.course_id = ?
         ORDER BY cn.position ASC`
   )
   .all(courseId) as any[];

  const edgeRows = this.db
   .prepare(
    `SELECT from_node_id, to_node_id, COALESCE(relation_type, 'prerequisite') as relation_type
         FROM course_edges
         WHERE course_id = ?`
   )
   .all(courseId) as any[];

  return {
   courseId,
   title,
   nodes: nodeRows.map((r) => ({
    knowledgeNodeId: r.knowledge_node_id,
    title: r.title,
    position: r.position,
    description: r.description ?? undefined,
   })),
   edges: edgeRows.map((r) => ({
    fromNodeId: r.from_node_id,
    toNodeId: r.to_node_id,
    relationType: r.relation_type,
   })),
  };
 }

 getCourseEvidence(courseId: string): CourseEvidenceItem[] {
  const rows = this.db
   .prepare(
    `SELECT c.id AS claim_id, c.knowledge_node_id, c.statement, c.status,
            c.confidence AS claim_confidence, ce.id AS evidence_id,
            ce.excerpt, ce.relation, ce.confidence AS evidence_confidence,
            d.title AS source_title
       FROM claims c
       JOIN course_nodes cn ON cn.knowledge_node_id = c.knowledge_node_id
       JOIN claim_evidence ce ON ce.claim_id = c.id AND ce.is_active = 1
       JOIN document_chunks dc ON dc.id = ce.document_chunk_id
       JOIN document_versions dv ON dv.id = dc.document_version_id
       JOIN course_sources cs ON cs.course_id = ? AND cs.document_id = dv.document_id
       JOIN documents d ON d.id = dv.document_id
      WHERE cn.course_id = ? AND c.status != 'deprecated'
      ORDER BY cn.position ASC, c.created_at ASC, ce.created_at ASC`
   )
   .all(courseId, courseId) as any[];

  return rows.map((row) => ({
   claimId: row.claim_id,
   knowledgeNodeId: row.knowledge_node_id,
   statement: row.statement,
   status: row.status,
   claimConfidence: row.claim_confidence,
   evidenceId: row.evidence_id,
   excerpt: row.excerpt,
   relation: row.relation,
   evidenceConfidence: row.evidence_confidence,
   sourceTitle: row.source_title,
  }));
 }
}
