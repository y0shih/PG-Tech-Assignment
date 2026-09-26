import { describe, it, expect, vi } from 'vitest';
import { withReliability } from '../../src/infrastructure/reliability.js';
import { ToolTimeoutError, ToolMalformedError, ToolError } from '../../src/domain/errors.js';
import { z } from 'zod';

describe('Reliability Wrapper & Failure Injection', () => {
  it('should return result on successful execution', async () => {
    const fn = async () => ({ value: 42 });
    const schema = z.object({ value: z.number() });
    const result = await withReliability('test', fn, { schema });
    expect(result.value).toBe(42);
  });

  it('should timeout and throw ToolTimeoutError if duration exceeded', async () => {
    const fn = async () => {
      await new Promise(r => setTimeout(r, 100));
      return { value: 1 };
    };
    await expect(withReliability('test', fn, { timeoutMs: 20, retries: 0 }))
      .rejects.toBeInstanceOf(ToolTimeoutError);
  });

  it('should throw ToolMalformedError when schema validation fails', async () => {
    const fn = async () => ({ value: 'not-a-number' });
    const schema = z.object({ value: z.number() });
    await expect(withReliability('test', fn, { schema, retries: 0 }))
      .rejects.toBeInstanceOf(ToolMalformedError);
  });

  it('should inject timeout failure when override configured', async () => {
    const fn = async () => ({ value: 100 });
    await expect(withReliability('pricing', fn, { injection: 'timeout' }))
      .rejects.toBeInstanceOf(ToolTimeoutError);
  });

  it('should inject error failure when override configured', async () => {
    const fn = async () => ({ value: 100 });
    await expect(withReliability('customer', fn, { injection: 'error' }))
      .rejects.toBeInstanceOf(ToolError);
  });

  it('should inject malformed failure when override configured', async () => {
    const fn = async () => ({ value: 100 });
    await expect(withReliability('customer', fn, { injection: 'malformed' }))
      .rejects.toBeInstanceOf(ToolMalformedError);
  });

  it('should retry on transient error and succeed', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts === 1) throw new Error('Network blip');
      return { success: true };
    };
    const result = await withReliability('test', fn, { retries: 2, backoffMs: 10 });
    expect(result.success).toBe(true);
    expect(attempts).toBe(2);
  });

  it('should fail after exhausting retries', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error('Persistent failure');
    };
    await expect(withReliability('test', fn, { retries: 2, backoffMs: 5 }))
      .rejects.toBeInstanceOf(ToolError);
    expect(attempts).toBe(3);
  });

  it('should check environment variable for failure injection if option omitted', async () => {
    process.env.FAIL_INVENTORY_LOOKUP = 'timeout';
    try {
      const fn = async () => 10;
      await expect(withReliability('inventory', fn))
        .rejects.toBeInstanceOf(ToolTimeoutError);
    } finally {
      delete process.env.FAIL_INVENTORY_LOOKUP;
    }
  });

  it('should check environment variable without _LOOKUP suffix (e.g. FAIL_MESSAGING)', async () => {
    process.env.FAIL_MESSAGING = 'error';
    try {
      const fn = async () => 10;
      await expect(withReliability('messaging', fn))
        .rejects.toBeInstanceOf(ToolError);
    } finally {
      delete process.env.FAIL_MESSAGING;
    }
  });
});
