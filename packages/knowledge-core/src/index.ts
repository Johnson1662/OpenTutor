import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface SourceChunk { id: string; ordinal: number; heading?: string; level: number; content: string }
export interface SourceDocument { id: string; title: string; sourceUri?: string; version: number; contentHash: string; chunks: SourceChunk[] }
export interface KnowledgeSearchResult { id: string; title: string; summary: string; sources: string[] }

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

export function parseMarkdown(content: string): SourceChunk[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const chunks: SourceChunk[] = [];
  let heading: string | undefined;
  let level = 0;
  let body: string[] = [];
  const flush = () => {
    const text = body.join('\n').trim();
    if (text) chunks.push({ id: randomUUID(), ordinal: chunks.length, heading, level, content: text });
    body = [];
  };
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) { flush(); level = match[1].length; heading = match[2]; continue; }
    body.push(line);
  }
  flush();
  return chunks;
}

export class KnowledgeCompiler {
  private readonly db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  ingest(input: { id?: string; title: string; sourceUri?: string; content: string }): SourceDocument {
    const id = input.id ?? randomUUID();
    const contentHash = hash(input.content);
    const existing = this.db.prepare('SELECT id, version, content_hash FROM document_versions WHERE document_id = ? AND content_hash = ?').get(id, contentHash) as { id: string; version: number; content_hash: string } | undefined;
    if (existing) return { id, title: input.title, sourceUri: input.sourceUri, version: existing.version, contentHash, chunks: this.chunks(id, existing.id) };
    const version = (this.db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM document_versions WHERE document_id = ?').get(id) as { version: number }).version;
    const chunks = parseMarkdown(input.content);
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO documents (id, source_uri, title) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET source_uri = excluded.source_uri, title = excluded.title, updated_at = datetime(\'now\')').run(id, input.sourceUri ?? null, input.title);
      const versionId = randomUUID();
      this.db.prepare('INSERT INTO document_versions (id, document_id, version, content_hash, content) VALUES (?, ?, ?, ?, ?)').run(versionId, id, version, contentHash, input.content);
      const section = this.db.prepare('INSERT INTO document_sections (id, document_version_id, document_id, ordinal, heading, level, content) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const chunk = this.db.prepare('INSERT INTO document_chunks (id, document_section_id, document_version_id, ordinal, content, content_hash) VALUES (?, ?, ?, ?, ?, ?)');
      for (const item of chunks) {
        const sectionId = randomUUID();
        section.run(sectionId, versionId, id, item.ordinal, item.heading ?? null, item.level, item.content);
        chunk.run(item.id, sectionId, versionId, item.ordinal, item.content, hash(item.content));
      }
    })();
    const row = this.db.prepare('SELECT id FROM document_versions WHERE document_id = ? AND version = ?').get(id, version) as { id: string };
    return { id, title: input.title, sourceUri: input.sourceUri, version, contentHash, chunks: this.chunks(id, row.id) };
  }

  search(query: string, limit = 10): KnowledgeSearchResult[] {
    const q = `%${normalize(query)}%`;
    return this.db.prepare(`SELECT n.id, n.title, n.description AS summary, GROUP_CONCAT(DISTINCT c.id) AS sources
      FROM knowledge_nodes n LEFT JOIN claims cl ON cl.knowledge_node_id = n.id LEFT JOIN claim_evidence ce ON ce.claim_id = cl.id LEFT JOIN document_chunks c ON c.id = ce.document_chunk_id
      WHERE lower(n.title) LIKE ? OR lower(COALESCE(n.description, '')) LIKE ? OR lower(COALESCE(cl.statement, '')) LIKE ?
      GROUP BY n.id ORDER BY n.title LIMIT ?`).all(q, q, q, limit).map((row: any) => ({ id: row.id, title: row.title, summary: row.summary ?? '', sources: row.sources ? row.sources.split(',') : [] }));
  }

  private chunks(documentId: string, versionId: string): SourceChunk[] {
    return this.db.prepare('SELECT c.id, c.ordinal, s.heading, s.level, c.content FROM document_chunks c JOIN document_sections s ON s.id = c.document_section_id WHERE c.document_version_id = ? ORDER BY c.ordinal').all(versionId) as SourceChunk[];
  }
}

export class EntityResolver {
  private readonly db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }
  resolve(name: string): { id: string; title: string; created: boolean } {
    const normalized = normalize(name);
    const found = this.db.prepare('SELECT id, title FROM knowledge_nodes WHERE lower(title) = ? UNION SELECT n.id, n.title FROM knowledge_node_aliases a JOIN knowledge_nodes n ON n.id = a.knowledge_node_id WHERE a.normalized_name = ? LIMIT 1').get(normalized, normalized) as { id: string; title: string } | undefined;
    if (found) return { ...found, created: false };
    const id = randomUUID();
    this.db.prepare('INSERT INTO knowledge_nodes (id, title, description, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(id, name.trim(), '');
    return { id, title: name.trim(), created: true };
  }
}

export class KnowledgeRetriever {
  private readonly db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }
  search(query: string, limit = 10): KnowledgeSearchResult[] { return new KnowledgeCompiler(this.db).search(query, limit); }
  sourceRead(chunkId: string): SourceChunk | null { return this.db.prepare('SELECT c.id, c.ordinal, s.heading, s.level, c.content FROM document_chunks c JOIN document_sections s ON s.id = c.document_section_id WHERE c.id = ?').get(chunkId) as SourceChunk | null; }
}
