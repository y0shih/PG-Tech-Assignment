import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import type { InboundMessage } from '../domain/models.js';
import type { DecisionRecord } from '../domain/decisions.js';

export function computeFingerprint(source: string, sender: string, content: string): string {
  const normalized = [
    source.trim().toLowerCase(),
    sender.trim().toLowerCase(),
    content.trim().toLowerCase().replace(/\s+/g, ' ')
  ].join('|');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function initDatabase(dbPath: string = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS inbound_messages (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_fingerprint ON inbound_messages(fingerprint);

    CREATE TABLE IF NOT EXISTS decisions (
      run_id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      received_at TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decisions_message_id ON decisions(message_id);
  `);

  return db;
}

export function isDuplicateMessage(db: DatabaseSync, messageId: string, fingerprint: string): boolean {
  const query = db.prepare(`
    SELECT id FROM inbound_messages WHERE id = ? OR fingerprint = ? LIMIT 1
  `);
  const row = query.get(messageId, fingerprint);
  return row !== undefined;
}

export function saveInboundMessage(db: DatabaseSync, message: InboundMessage, fingerprint: string): void {
  const stmt = db.prepare(`
    INSERT INTO inbound_messages (id, source, sender, content, fingerprint, received_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(message.id, message.source, message.sender, message.content, fingerprint, message.receivedAt);
}

export function saveDecisionRecord(db: DatabaseSync, record: DecisionRecord): void {
  const stmt = db.prepare(`
    INSERT INTO decisions (run_id, message_id, fingerprint, received_at, action, reason, record_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    record.runId,
    record.messageId,
    record.fingerprint,
    record.receivedAt,
    record.decision.action,
    record.decision.reason,
    JSON.stringify(record)
  );
}

export function getDecisionRecord(db: DatabaseSync, runId: string): DecisionRecord | null {
  const query = db.prepare(`SELECT record_json FROM decisions WHERE run_id = ?`);
  const row = query.get(runId) as { record_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.record_json) as DecisionRecord;
}

export function listDecisionRecords(db: DatabaseSync, limit: number = 50): DecisionRecord[] {
  const query = db.prepare(`SELECT record_json FROM decisions ORDER BY rowid DESC LIMIT ?`);
  const rows = query.all(limit) as { record_json: string }[];
  return rows.map(r => JSON.parse(r.record_json) as DecisionRecord);
}

export function clearDatabase(db: DatabaseSync): void {
  db.exec(`
    DELETE FROM inbound_messages;
    DELETE FROM decisions;
  `);
}


