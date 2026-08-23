import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface CourseRecord {
 id: string;
 title: string;
 description?: string;
 compileStatus: 'draft' | 'compiling' | 'ready' | 'failed' | 'active' | 'archived';
 compiledAt?: string;
 compileError?: string;
 createdAt: string;
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
 }): CourseRecord {
  const now = new Date().toISOString();
  const status = course.compileStatus ?? 'draft';

  this.db
   .prepare(
    `INSERT INTO courses (id, title, description, compile_status, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           compile_status = excluded.compile_status`
   )
   .run(course.id, course.title, course.description ?? '', status, now);

  return this.getCourse(course.id)!;
 }

 getCourse(id: string): CourseRecord | null {
  const row = this.db
   .prepare(
    'SELECT id, title, description, compile_status, compiled_at, compile_error, created_at FROM courses WHERE id = ?'
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
  };
 }

 listCourses(): CourseRecord[] {
  const rows = this.db
   .prepare(
    'SELECT id, title, description, compile_status, compiled_at, compile_error, created_at FROM courses ORDER BY created_at DESC'
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

 addCourseSource(
  courseId: string,
  title: string,
  content: string
 ): CourseSourceRecord {
  const documentId = `doc-${randomUUID()}`;
  const versionId = `ver-${randomUUID()}`;
  const now = new Date().toISOString();

  this.db.transaction(() => {
   this.db
    .prepare('INSERT INTO documents (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(documentId, title, now, now);

   this.db
    .prepare(
     'INSERT INTO document_versions (id, document_id, version, content_hash, content, status, created_at) VALUES (?, ?, 1, ?, ?, ?, ?)'
    )
    .run(versionId, documentId, `${content.length}`, content, 'active', now);

   this.db
    .prepare(
     `INSERT INTO course_sources (course_id, document_id, created_at)
           VALUES (?, ?, ?)
           ON CONFLICT(course_id, document_id) DO NOTHING`
    )
    .run(courseId, documentId, now);
  })();

  return {
   id: documentId,
   courseId,
   documentId,
   title,
   content,
   version: 1,
   status: 'active',
   createdAt: now,
  };
 }

 listCourseSources(courseId: string): CourseSourceRecord[] {
  const rows = this.db
   .prepare(
    `SELECT d.id, d.title, dv.content, dv.version, dv.status, dv.created_at
         FROM documents d
         JOIN course_sources cs ON cs.document_id = d.id
         JOIN document_versions dv ON dv.document_id = d.id
         WHERE cs.course_id = ? AND dv.status != 'deleted'
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
  const deleteTx = this.db.transaction(() => {
   this.db
    .prepare('DELETE FROM course_sources WHERE course_id = ? AND document_id = ?')
    .run(courseId, documentId);

   this.db
    .prepare(`UPDATE document_versions SET status = 'deleted' WHERE document_id = ?`)
    .run(documentId);
  });

  deleteTx();
  return true;
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
}
