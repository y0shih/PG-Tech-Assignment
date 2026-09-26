import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDatabase,
  computeFingerprint,
  isDuplicateMessage,
  saveInboundMessage,
  saveDecisionRecord,
  getDecisionRecord,
} from '../../src/infrastructure/db.js';
import type { DecisionRecord } from '../../src/domain/decisions.js';

describe('Database & Idempotency Storage', () => {
  let db: any;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  it('should compute deterministic SHA-256 fingerprint ignoring whitespace and casing', () => {
    const hash1 = computeFingerprint('zalo', ' 0901234567 ', 'Cho 5 Thung Ly 500ml');
    const hash2 = computeFingerprint('ZALO', '0901234567', 'cho 5 thung ly 500ml');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('should detect duplicate message by messageId and fingerprint', () => {
    const msg = {
      id: 'msg-001',
      source: 'zalo' as const,
      sender: '0901234567',
      content: '5 thung ly 500ml',
      receivedAt: new Date().toISOString(),
    };
    const fp = computeFingerprint(msg.source, msg.sender, msg.content);

    expect(isDuplicateMessage(db, msg.id, fp)).toBe(false);

    saveInboundMessage(db, msg, fp);

    // Same ID duplicate
    expect(isDuplicateMessage(db, 'msg-001', 'different_fp')).toBe(true);
    // Same fingerprint duplicate under different ID
    expect(isDuplicateMessage(db, 'msg-002', fp)).toBe(true);
  });

  it('should save and retrieve full decision record', () => {
    const record: DecisionRecord = {
      runId: 'run-001',
      messageId: 'msg-001',
      fingerprint: 'dummy-fp',
      receivedAt: new Date().toISOString(),
      input: { source: 'zalo', sender: '0901', content: 'test' },
      interpretation: null,
      resolution: { customer: null, products: [], stock: null, unitPrice: null },
      policyChecks: { duplicate: false },
      advisor: { provider: 'deterministic', recommendation: 'ESCALATE' },
      decision: { action: 'ESCALATE', reason: 'CUSTOMER_NOT_FOUND' },
      action: { executed: false },
      metrics: { latencyMs: 50, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };

    saveDecisionRecord(db, record);
    const retrieved = getDecisionRecord(db, 'run-001');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.decision.reason).toBe('CUSTOMER_NOT_FOUND');
    expect(retrieved?.metrics.latencyMs).toBe(50);
  });
});
