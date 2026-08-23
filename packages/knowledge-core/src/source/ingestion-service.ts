import { randomUUID } from 'node:crypto';
import type { Database } from '@opentutor/database';
import { parseMarkdown, type SourceChunk } from './markdown-parser.ts';
import { computeSha256 } from './source-hash.ts';

export interface IngestDocumentInput {
 id?: string;
 title: string;
 sourceUri?: string;
 content: string;
}

export interface IngestedDocument {
 id: string;
 documentVersionId: string;
 title: string;
 sourceUri?: string;
 version: number;
 contentHash: string;
 chunks: SourceChunk[];
 isNewVersion: boolean;
}

interface VersionRow {
 id: string;
 version: number;
 content_hash: string;
}

export class IngestionService {
 private readonly db: Database;

 constructor(db: Database) {
  this.db = db;
 }

 ingest(input: IngestDocumentInput): IngestedDocument {
  const id = input.id ?? randomUUID();
  const contentHash = computeSha256(input.content);

  const existing = this.db
   .prepare(
    'SELECT id, version, content_hash FROM document_versions WHERE document_id = ? AND content_hash = ?'
   )
   .get(id, contentHash) as VersionRow | undefined;

  if (existing) {
   return {
    id,
    documentVersionId: existing.id,
    title: input.title,
    sourceUri: input.sourceUri,
    version: existing.version,
    contentHash,
    chunks: this.getChunks(existing.id),
    isNewVersion: false,
   };
  }

  const versionRow = this.db
   .prepare(
    'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM document_versions WHERE document_id = ?'
   )
   .get(id) as { next_version: number };

  const version = versionRow.next_version;
  const chunks = parseMarkdown(input.content);
  const versionId = randomUUID();

  this.db.transaction(() => {
   this.db
    .prepare(
     `INSERT INTO documents (id, source_uri, title, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
             source_uri = excluded.source_uri,
             title = excluded.title,
             updated_at = datetime('now')`
    )
    .run(id, input.sourceUri ?? null, input.title);

   this.db
    .prepare(
     `INSERT INTO document_versions (id, document_id, version, content_hash, content, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))`
    )
    .run(versionId, id, version, contentHash, input.content);

   const insertSection = this.db.prepare(
    `INSERT INTO document_sections (id, document_version_id, document_id, ordinal, heading, level, content)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
   );

   const insertChunk = this.db.prepare(
    `INSERT INTO document_chunks (id, document_section_id, document_version_id, ordinal, content, content_hash)
         VALUES (?, ?, ?, ?, ?, ?)`
   );

   const insertFts = this.db.prepare(
    `INSERT INTO source_fts (chunk_id, document_id, document_title, heading, content)
         VALUES (?, ?, ?, ?, ?)`
   );

   for (const item of chunks) {
    const sectionId = randomUUID();
    insertSection.run(
     sectionId,
     versionId,
     id,
     item.ordinal,
     item.heading ?? null,
     item.level,
     item.content
    );

    insertChunk.run(
     item.id,
     sectionId,
     versionId,
     item.ordinal,
     item.content,
     item.contentHash
    );

    insertFts.run(
     item.id,
     id,
     input.title,
     item.heading ?? null,
     item.content
    );
   }
  })();

  return {
   id,
   documentVersionId: versionId,
   title: input.title,
   sourceUri: input.sourceUri,
   version,
   contentHash,
   chunks,
   isNewVersion: true,
  };
 }

 private getChunks(documentVersionId: string): SourceChunk[] {
  const rows = this.db
   .prepare(
    `SELECT id, ordinal, content, content_hash
         FROM document_chunks
         WHERE document_version_id = ?
         ORDER BY ordinal ASC`
   )
   .all(documentVersionId) as Array<{
    id: string;
    ordinal: number;
    content: string;
    content_hash: string;
   }>;

  return rows.map((r) => ({
   id: r.id,
   ordinal: r.ordinal,
   level: 0,
   content: r.content,
   contentHash: r.content_hash,
  }));
 }
}
