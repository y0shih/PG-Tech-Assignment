import { describe, it, expect, vi } from 'vitest';
import { EVAL_CASES } from '../../eval/cases.js';
import { printEvalSummary } from '../../eval/reporter.js';
import { runEvaluation } from '../../eval/runner.js';

describe('Evaluation Cases Definition', () => {
  it('should define exactly 18 evaluation cases', () => {
    expect(EVAL_CASES).toHaveLength(18);
  });

  it('should include prompt injection, duplicate, credit hold, and tool timeout cases', () => {
    const ids = EVAL_CASES.map(c => c.id);
    expect(ids).toContain('eval-05-credit-hold');
    expect(ids).toContain('eval-08-duplicate');
    expect(ids).toContain('eval-09-prompt-injection');
    expect(ids).toContain('eval-14-tool-timeout');
  });
});

describe('Evaluation Reporter', () => {
  it('should return true when all test cases pass', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});

    const passed = printEvalSummary([
      {
        id: 'test-1',
        description: 'Test case 1',
        passed: true,
        expectedAction: 'QUOTE',
        actualAction: 'QUOTE',
        expectedReason: 'ORDER_READY',
        actualReason: 'ORDER_READY',
        latencyMs: 10,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.001,
      },
    ], 'deterministic');

    expect(passed).toBe(true);
    expect(logSpy).toHaveBeenCalled();
    expect(tableSpy).toHaveBeenCalled();

    logSpy.mockRestore();
    tableSpy.mockRestore();
  });

  it('should return false when at least one case fails', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});

    const passed = printEvalSummary([
      {
        id: 'test-fail',
        description: 'Failing case',
        passed: false,
        expectedAction: 'QUOTE',
        actualAction: 'ESCALATE',
        expectedReason: 'ORDER_READY',
        actualReason: 'TOOL_ERROR',
        latencyMs: 5,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      },
    ], 'deterministic');

    expect(passed).toBe(false);

    logSpy.mockRestore();
    tableSpy.mockRestore();
  });

  it('should return false when run is aborted early (executed < expectedTotal)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});

    // Only 2 cases executed, but 18 expected
    const passed = printEvalSummary([
      {
        id: 'test-1',
        description: 'Test case 1',
        passed: true,
        expectedAction: 'QUOTE',
        actualAction: 'QUOTE',
        expectedReason: 'ORDER_READY',
        actualReason: 'ORDER_READY',
        latencyMs: 10,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.001,
      },
      {
        id: 'test-2',
        description: 'Test case 2',
        passed: true,
        expectedAction: 'ASK',
        actualAction: 'ASK',
        expectedReason: 'QUANTITY_MISSING',
        actualReason: 'QUANTITY_MISSING',
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      },
    ], 'deterministic', 18);

    expect(passed).toBe(false);

    logSpy.mockRestore();
    tableSpy.mockRestore();
  });
});

describe('Evaluation Runner', () => {
  const originalMode = process.env.INTERPRETER_MODE;

  it('should execute full 18-case evaluation successfully in mock mode', async () => {
    process.env.INTERPRETER_MODE = 'mock';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});

    const success = await runEvaluation();
    expect(success).toBe(true);

    logSpy.mockRestore();
    tableSpy.mockRestore();
    process.env.INTERPRETER_MODE = originalMode;
  });

  it('should support running with jev advisor parameter', async () => {
    process.env.INTERPRETER_MODE = 'mock';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});

    const success = await runEvaluation('jev');
    expect(success).toBe(true);

    logSpy.mockRestore();
    tableSpy.mockRestore();
    process.env.INTERPRETER_MODE = originalMode;
  });
});
