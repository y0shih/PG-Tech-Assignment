export interface EvalCaseResult {
  id: string;
  description: string;
  passed: boolean;
  expectedAction: string;
  actualAction: string;
  expectedReason: string;
  actualReason: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export function printEvalSummary(results: EvalCaseResult[], advisorName: string): boolean {
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;
  const passRate = ((passed / total) * 100).toFixed(1);

  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const avgLatency = (latencies.reduce((a, b) => a + b, 0) / total).toFixed(0);
  const p95Latency = latencies[Math.floor(total * 0.95)] || latencies[total - 1] || 0;

  const totalCost = results.reduce((acc, r) => acc + r.costUsd, 0);
  const totalTokensIn = results.reduce((acc, r) => acc + r.tokensIn, 0);
  const totalTokensOut = results.reduce((acc, r) => acc + r.tokensOut, 0);

  console.log('\n============================================================');
  console.log(` ORDER DESK EVALUATION REPORT [Advisor: ${advisorName.toUpperCase()}]`);
  console.log('============================================================');
  console.table(
    results.map(r => ({
      ID: r.id,
      Status: r.passed ? 'PASS' : 'FAIL',
      Expected: `${r.expectedAction} / ${r.expectedReason}`,
      Actual: `${r.actualAction} / ${r.actualReason}`,
      Latency: `${r.latencyMs}ms`,
      Cost: `$${r.costUsd.toFixed(5)}`,
    }))
  );

  console.log('------------------------------------------------------------');
  console.log(`Total Cases:    ${total}`);
  console.log(`Passed:         ${passed}`);
  console.log(`Failed:         ${failed}`);
  console.log(`Pass Rate:      ${passRate}%`);
  console.log(`Avg Latency:    ${avgLatency}ms`);
  console.log(`P95 Latency:    ${p95Latency}ms`);
  console.log(`Tokens (In/Out): ${totalTokensIn} / ${totalTokensOut}`);
  console.log(`Total Cost:     $${totalCost.toFixed(5)} (Cap: $20.00)`);
  console.log('============================================================\n');

  return failed === 0;
}
