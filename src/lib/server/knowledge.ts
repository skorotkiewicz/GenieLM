import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { getCurrentPlatform } from '@sqliteai/sqlite-vector';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DIMENSIONS = 384;
const MODEL_PATH = resolve('multilingual-e5-small');
const DATABASE_PATH = resolve('knowledge.db');

let database: DatabaseSync | undefined;
let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

function vectorExtensionPath() {
	const report = process.report?.getReport?.() as
		{ header?: { glibcVersionRuntime?: string } } | undefined;
	let platform: string = getCurrentPlatform();
	if (report?.header?.glibcVersionRuntime) platform = platform.replace(/-musl$/, '');
	const extension = createRequire(import.meta.url)(`@sqliteai/sqlite-vector-${platform}`) as {
		path: string;
	};
	return extension.path;
}

function getDatabase() {
	if (database) return database;

	const db = new DatabaseSync(DATABASE_PATH, { allowExtension: true });
	db.loadExtension(vectorExtensionPath());
	db.enableLoadExtension(false);
	db.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE IF NOT EXISTS documents (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			created_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS chunks (
			id INTEGER PRIMARY KEY,
			document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
			position INTEGER NOT NULL,
			content TEXT NOT NULL,
			embedding BLOB NOT NULL
		);
	`);
	db.prepare(
		`SELECT vector_init('chunks', 'embedding', 'type=FLOAT32,dimension=${DIMENSIONS},distance=COSINE')`
	).get();
	database = db;
	return db;
}

async function getExtractor() {
	extractorPromise ??= pipeline('feature-extraction', MODEL_PATH, {
		local_files_only: true,
		dtype: 'q8'
	});
	return extractorPromise;
}

async function embed(texts: string[], prefix: 'query' | 'passage') {
	const extractor = await getExtractor();
	const vectors: Float32Array[] = [];

	for (let offset = 0; offset < texts.length; offset += 16) {
		const batch = texts.slice(offset, offset + 16).map((text) => `${prefix}: ${text}`);
		const output = await extractor(batch, { pooling: 'mean', normalize: true });
		for (const vector of output.tolist() as number[][]) vectors.push(Float32Array.from(vector));
	}

	return vectors;
}

function blob(vector: Float32Array) {
	return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function chunkText(value: string) {
	const text = value
		.replace(/\r\n?/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	const chunks: string[] = [];
	let start = 0;

	while (start < text.length) {
		let end = Math.min(start + 1_200, text.length);
		if (end < text.length) {
			const boundary = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf(' ', end));
			if (boundary > start + 600) end = boundary;
		}
		chunks.push(text.slice(start, end).trim());
		if (end === text.length) break;
		start = Math.max(end - 150, start + 1);
	}

	return chunks.filter(Boolean);
}

export function listKnowledgeDocuments() {
	return getDatabase()
		.prepare(
			`SELECT d.id, d.name, d.created_at AS createdAt, COUNT(c.id) AS chunks
			 FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
			 GROUP BY d.id ORDER BY d.created_at DESC`
		)
		.all() as { id: number; name: string; createdAt: number; chunks: number }[];
}

export async function addKnowledgeDocument(name: string, content: string) {
	const chunks = chunkText(content);
	if (!chunks.length) throw new Error('Document is empty.');
	const db = getDatabase();
	const vectors = await embed(chunks, 'passage');

	db.exec('BEGIN IMMEDIATE');
	try {
		const existing = db.prepare('SELECT id FROM documents WHERE name = ?').get(name) as
			{ id: number } | undefined;
		const id = existing
			? existing.id
			: Number(
					db.prepare('INSERT INTO documents(name, created_at) VALUES(?, ?)').run(name, Date.now())
						.lastInsertRowid
				);
		if (existing) {
			db.prepare('DELETE FROM chunks WHERE document_id = ?').run(id);
			db.prepare('UPDATE documents SET created_at = ? WHERE id = ?').run(Date.now(), id);
		}

		const insert = db.prepare(
			`INSERT INTO chunks(document_id, position, content, embedding)
			 VALUES(?, ?, ?, vector_as_f32(?, ${DIMENSIONS}))`
		);
		chunks.forEach((chunk, index) => insert.run(id, index, chunk, blob(vectors[index])));
		db.exec('COMMIT');
		return { id, name, chunks: chunks.length };
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
}

export function deleteKnowledgeDocument(id: number) {
	return getDatabase().prepare('DELETE FROM documents WHERE id = ?').run(id).changes > 0;
}

export async function searchKnowledge(query: string, limit = 5) {
	const db = getDatabase();
	const count = db.prepare('SELECT COUNT(*) AS count FROM chunks').get() as { count: number };
	if (!count.count) return [];

	const [vector] = await embed([query], 'query');
	return db
		.prepare(
			`SELECT d.name, c.content, v.distance
			 FROM vector_full_scan('chunks', 'embedding', ?, ?) AS v
			 JOIN chunks c ON c.id = v.rowid
			 JOIN documents d ON d.id = c.document_id`
		)
		.all(blob(vector), BigInt(limit)) as {
		name: string;
		content: string;
		distance: number;
	}[];
}
