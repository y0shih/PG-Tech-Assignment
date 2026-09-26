import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

describe('Submission Documentation Compliance', () => {
  it('should verify SUBMISSION.md exists and is under 800 words', () => {
    const filePath = path.resolve(process.cwd(), 'SUBMISSION.md');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf8');
    const wordCount = content.trim().split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(800);
  });

  it('should contain all 8 required rubric sections in SUBMISSION.md', () => {
    const content = readFileSync(path.resolve(process.cwd(), 'SUBMISSION.md'), 'utf8');
    expect(content).toContain('Design Decisions');
    expect(content).toContain('Agent vs Deterministic Responsibilities');
    expect(content).toContain('Failure Handling');
    expect(content).toContain('Evaluation Results');
    expect(content).toContain('Cost and Latency');
    expect(content).toContain('n8n Migration');
    expect(content).toContain('AI Tools Used');
    expect(content).toContain('Known Gaps');
  });

  it('should verify README.md exists and contains quickstart commands', () => {
    const readme = readFileSync(path.resolve(process.cwd(), 'README.md'), 'utf8');
    expect(readme).toContain('npm test');
    expect(readme).toContain('npm run eval');
    expect(readme).toContain('POST /v1/orders/process');
  });
});
