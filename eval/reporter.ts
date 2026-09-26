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

export function printEvalSummary(
  results: EvalCaseResult[],
  advisorName: string,
  expectedTotal: number = results.length
): boolean {
  const executed = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = expectedTotal - passed;
  const passRate = expectedTotal > 0 ? ((passed / expectedTotal) * 100).toFixed(1) : '0.0';

  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const avgLatency = executed > 0 ? (latencies.reduce((a, b) => a + b, 0) / executed).toFixed(0) : '0';
  const p95Latency = latencies[Math.floor(executed * 0.95)] ?? latencies[executed - 1] ?? 0;

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
  console.log(`Total Cases:    ${expectedTotal}`);
  if (executed !== expectedTotal) {
    console.log(`Executed:       ${executed} (aborted early)`);
  }
  console.log(`Passed:         ${passed}`);
  console.log(`Failed:         ${failed}`);
  console.log(`Pass Rate:      ${passRate}%`);
  console.log(`Avg Latency:    ${avgLatency}ms`);
  console.log(`P95 Latency:    ${p95Latency}ms`);
  console.log(`Tokens (In/Out): ${totalTokensIn} / ${totalTokensOut}`);
  console.log(`Total Cost:     $${totalCost.toFixed(5)} (Cap: $20.00)`);
  console.log('============================================================\n');

  return failed === 0 && executed === expectedTotal;
}
