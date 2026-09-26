import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVAL_CASES } from './cases.js';
import { printEvalSummary, type EvalCaseResult } from './reporter.js';
import { initDatabase } from '../src/infrastructure/db.js';
import { JsonCustomerRepository } from '../src/tools/customers.js';
import { JsonProductRepository } from '../src/tools/products.js';
import { JsonInventoryRepository } from '../src/tools/inventory.js';
import { JsonPricingRepository } from '../src/tools/pricing.js';
import { MockMessagingService } from '../src/tools/messaging.js';
import { createInterpreter } from '../src/agent/anthropic-interpreter.js';
import { createAdvisor } from '../src/advisors/jev-advisor.js';
import { OrderDeskPipeline } from '../src/application/pipeline.js';

dotenv.config();

export async function runEvaluation(): Promise<boolean> {
  const db = initDatabase(':memory:');
  const advisor = createAdvisor();
  const interpreter = createInterpreter();
  const pipeline = new OrderDeskPipeline({
    db,
    customerRepo: new JsonCustomerRepository(),
    productRepo: new JsonProductRepository(),
    inventoryRepo: new JsonInventoryRepository(),
    pricingRepo: new JsonPricingRepository(),
    messagingService: new MockMessagingService(),
    interpreter,
    advisor,
  });

  const results: EvalCaseResult[] = [];
  let cumulativeSpend = 0;

  for (const c of EVAL_CASES) {
    if (cumulativeSpend > 19.5) {
      console.error('CRITICAL: Budget limit reached ($20). Aborting evaluation.');
      break;
    }

    if (c.duplicateRun) {
      // Seed first occurrence
      await pipeline.processMessage({
        id: `${c.id}-seed`,
        source: c.message.source,
        sender: c.message.sender,
        content: c.message.content,
        receivedAt: new Date().toISOString(),
      });
    }

    const record = await pipeline.processMessage(
      {
        id: c.id,
        source: c.message.source,
        sender: c.message.sender,
        content: c.message.content,
        receivedAt: new Date().toISOString(),
      },
      c.overrides
    );

    cumulativeSpend += record.metrics.costUsd;
    const passed =
      record.decision.action === c.expectedAction &&
      record.decision.reason === c.expectedReason;

    results.push({
      id: c.id,
      description: c.description,
      passed,
      expectedAction: c.expectedAction,
      actualAction: record.decision.action,
      expectedReason: c.expectedReason,
      actualReason: record.decision.reason,
      latencyMs: record.metrics.latencyMs,
      tokensIn: record.metrics.inputTokens,
      tokensOut: record.metrics.outputTokens,
      costUsd: record.metrics.costUsd,
    });
  }

  const advisorName = process.env.DECISION_ADVISOR || 'deterministic';
  return printEvalSummary(results, advisorName);
}

const currentScript = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisFile = fileURLToPath(import.meta.url);
if (currentScript === thisFile || process.argv[1]?.endsWith('runner.ts') || process.argv[1]?.endsWith('runner.js')) {
  runEvaluation()
    .then(allPassed => {
      if (!allPassed) {
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('Evaluation runner failed:', err);
      process.exit(1);
    });
}
