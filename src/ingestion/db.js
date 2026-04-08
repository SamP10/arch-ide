import { DatabaseSync } from 'node:sqlite';
import path from 'path';

// @[SCHEMA_CHANGE] — any change to column names, types, or table names here requires:
//   1. Bumping the query strings in every db.js helper that references those columns
//   2. Updating the corresponding constant in src/constants.js (status enums)
//   3. Updating the session queries in src/session/index.js
// CREATE TABLE IF NOT EXISTS is intentional — openDb() is idempotent on existing DBs.
// DO NOT change to plain CREATE TABLE — it would break resume/incremental runs.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    stages_completed_json TEXT NOT NULL DEFAULT '[]',
    target_path TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    language TEXT,
    size_bytes INTEGER,
    git_hash TEXT,
    parse_status TEXT NOT NULL DEFAULT 'pending',
    hotspot_score INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    is_exported INTEGER NOT NULL DEFAULT 0,
    line_start INTEGER,
    line_end INTEGER
  );

  CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id),
    specifier TEXT NOT NULL,
    resolved_file_id INTEGER REFERENCES files(id),
    is_external INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id),
    caller_symbol_id INTEGER REFERENCES symbols(id),
    callee_name TEXT NOT NULL,
    callee_file_id INTEGER REFERENCES files(id),
    confidence TEXT NOT NULL DEFAULT 'resolved'
  );

  CREATE TABLE IF NOT EXISTS clusters (
    id TEXT PRIMARY KEY,
    file_count INTEGER NOT NULL DEFAULT 0,
    external_deps_json TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS cluster_files (
    cluster_id TEXT NOT NULL REFERENCES clusters(id),
    file_id INTEGER NOT NULL REFERENCES files(id),
    PRIMARY KEY (cluster_id, file_id)
  );

  CREATE TABLE IF NOT EXISTS diagrams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    node_count INTEGER,
    edge_count INTEGER,
    filter_threshold INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hypotheses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    raw_response_json TEXT NOT NULL,
    validated_json TEXT,
    corrections_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending_validation',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    corrected_at TEXT
  );
`;

export function openDb(archDir) {
  const dbPath = path.join(archDir, 'arch.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function createRun(db, runId, targetPath) {
  db.prepare(`
    INSERT INTO runs (id, started_at, target_path)
    VALUES (?, datetime('now'), ?)
  `).run(runId, targetPath);
}

export function markStageComplete(db, runId, stageName) {
  const row = db.prepare('SELECT stages_completed_json FROM runs WHERE id = ?').get(runId);
  const stages = JSON.parse(row.stages_completed_json);
  if (!stages.includes(stageName)) {
    stages.push(stageName);
    db.prepare('UPDATE runs SET stages_completed_json = ? WHERE id = ?')
      .run(JSON.stringify(stages), runId);
  }
}

export function getCompletedStages(db, runId) {
  const row = db.prepare('SELECT stages_completed_json FROM runs WHERE id = ?').get(runId);
  return row ? JSON.parse(row.stages_completed_json) : [];
}

export function markRunComplete(db, runId) {
  db.prepare(`UPDATE runs SET completed_at = datetime('now') WHERE id = ?`).run(runId);
}

export function insertFile(db, file) {
  const result = db.prepare(`
    INSERT OR REPLACE INTO files (path, language, size_bytes, git_hash, parse_status)
    VALUES (?, ?, ?, ?, ?)
  `).run(file.path, file.language, file.size_bytes, file.git_hash, file.parse_status);
  return Number(result.lastInsertRowid);
}

export function getFileByPath(db, filePath) {
  return db.prepare('SELECT * FROM files WHERE path = ?').get(filePath);
}

export function getAllFiles(db) {
  return db.prepare('SELECT * FROM files').all();
}

export function updateFileParseStatus(db, fileId, status) {
  db.prepare('UPDATE files SET parse_status = ? WHERE id = ?').run(status, fileId);
}

export function updateFileHotspotScore(db, fileId, score) {
  db.prepare('UPDATE files SET hotspot_score = ? WHERE id = ?').run(score, fileId);
}

export function insertSymbol(db, sym) {
  const result = db.prepare(`
    INSERT INTO symbols (file_id, name, kind, is_exported, line_start, line_end)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sym.file_id, sym.name, sym.kind, sym.is_exported, sym.line_start, sym.line_end);
  return Number(result.lastInsertRowid);
}

export function getSymbolsByFile(db, fileId) {
  return db.prepare('SELECT * FROM symbols WHERE file_id = ?').all(fileId);
}

export function getAllSymbols(db) {
  return db.prepare('SELECT * FROM symbols').all();
}

export function insertImport(db, imp) {
  db.prepare(`
    INSERT INTO imports (file_id, specifier, resolved_file_id, is_external)
    VALUES (?, ?, ?, ?)
  `).run(imp.file_id, imp.specifier, imp.resolved_file_id, imp.is_external);
}

export function getAllImports(db) {
  return db.prepare('SELECT * FROM imports').all();
}

export function insertCall(db, call) {
  db.prepare(`
    INSERT INTO calls (file_id, caller_symbol_id, callee_name, callee_file_id, confidence)
    VALUES (?, ?, ?, ?, ?)
  `).run(call.file_id, call.caller_symbol_id, call.callee_name, call.callee_file_id, call.confidence);
}

export function getAllCalls(db) {
  return db.prepare('SELECT * FROM calls').all();
}

export function insertCluster(db, cluster) {
  db.prepare(`
    INSERT OR REPLACE INTO clusters (id, file_count, external_deps_json)
    VALUES (?, ?, ?)
  `).run(cluster.id, cluster.file_count, cluster.external_deps_json);
}

export function insertClusterFile(db, clusterId, fileId) {
  db.prepare(`
    INSERT OR REPLACE INTO cluster_files (cluster_id, file_id) VALUES (?, ?)
  `).run(clusterId, fileId);
}

export function getClusterForFile(db, fileId) {
  return db.prepare(`
    SELECT cf.cluster_id FROM cluster_files cf WHERE cf.file_id = ?
  `).get(fileId);
}

export function getAllClusters(db) {
  return db.prepare('SELECT * FROM clusters').all();
}

export function getFilesInCluster(db, clusterId) {
  return db.prepare(`
    SELECT f.* FROM files f
    JOIN cluster_files cf ON cf.file_id = f.id
    WHERE cf.cluster_id = ?
  `).all(clusterId);
}

export function insertDiagram(db, diagram) {
  db.prepare(`
    INSERT INTO diagrams (run_id, type, content, node_count, edge_count, filter_threshold)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(diagram.run_id, diagram.type, diagram.content, diagram.node_count, diagram.edge_count, diagram.filter_threshold);
}

export function getDiagram(db, runId, type) {
  return db.prepare('SELECT * FROM diagrams WHERE run_id = ? AND type = ?').get(runId, type);
}

export function insertHypothesis(db, hypothesis) {
  const result = db.prepare(`
    INSERT INTO hypotheses (run_id, raw_response_json, status)
    VALUES (?, ?, ?)
  `).run(hypothesis.run_id, hypothesis.raw_response_json, hypothesis.status);
  return Number(result.lastInsertRowid);
}

export function updateHypothesis(db, id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE hypotheses SET ${sets} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
}

export function getLatestHypothesis(db, runId) {
  return db.prepare(`
    SELECT * FROM hypotheses WHERE run_id = ? ORDER BY id DESC LIMIT 1
  `).get(runId);
}
