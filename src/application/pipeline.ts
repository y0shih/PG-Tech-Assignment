import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { InboundMessage, CustomerRecord, ProductRecord, OrderIntent } from '../domain/models.js';
import type { DecisionRecord, DecisionReason } from '../domain/decisions.js';
import { DecisionReasons } from '../domain/decisions.js';
import { ToolTimeoutError, ToolMalformedError, ToolError, InterpreterError } from '../domain/errors.js';
import {
  computeFingerprint,
  isDuplicateMessage,
  saveInboundMessage,
  saveDecisionRecord,
} from '../infrastructure/db.js';
import type { CustomerRepository } from '../tools/customers.js';
import type { ProductRepository } from '../tools/products.js';
import type { InventoryRepository } from '../tools/inventory.js';
import type { PricingRepository } from '../tools/pricing.js';
import type { MessagingService } from '../tools/messaging.js';
import type { OrderInterpreter } from '../agent/interpreter.js';
import type { DecisionAdvisor, AdvisorRecommendation } from '../advisors/decision-advisor.js';
import { evaluatePolicy } from '../policy/policy-engine.js';
import { executeAction } from './action-executor.js';
import type { FailureInjectionMode } from '../infrastructure/reliability.js';

export interface PipelineDependencies {
  db: DatabaseSync;
  customerRepo: CustomerRepository;
  productRepo: ProductRepository;
  inventoryRepo: InventoryRepository;
  pricingRepo: PricingRepository;
  messagingService: MessagingService;
  interpreter: OrderInterpreter;
  advisor: DecisionAdvisor;
}

export interface PipelineOverrides {
  failCustomer?: FailureInjectionMode;
  failProduct?: FailureInjectionMode;
  failStock?: FailureInjectionMode;
  failPricing?: FailureInjectionMode;
  failMessaging?: FailureInjectionMode;
}

export class OrderDeskPipeline {
  processOrder = this.processMessage.bind(this);

  constructor(private deps: PipelineDependencies) {}

  async processMessage(message: InboundMessage, overrides: PipelineOverrides = {}): Promise<DecisionRecord> {
    const startTime = Date.now();
    const runId = `run_${crypto.randomBytes(8).toString('hex')}`;
    const fingerprint = computeFingerprint(message.source, message.sender, message.content);

    // 1. Idempotency Gate
    const duplicate = isDuplicateMessage(this.deps.db, message.id, fingerprint);
    if (duplicate) {
      const record: DecisionRecord = {
        runId,
        messageId: message.id,
        fingerprint,
        receivedAt: message.receivedAt,
        input: { source: message.source, sender: message.sender, content: message.content },
        interpretation: null,
        resolution: { customer: null, products: [], stock: null, unitPrice: null },
        policyChecks: { duplicate: true },
        advisor: { provider: 'deterministic', recommendation: 'DO_NOTHING' },
        decision: { action: 'DO_NOTHING', reason: DecisionReasons.DUPLICATE_MESSAGE },
        action: { executed: false },
        metrics: { latencyMs: Date.now() - startTime, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      };
      saveDecisionRecord(this.deps.db, record);
      return record;
    }

    // Persist new inbound message
    saveInboundMessage(this.deps.db, message, fingerprint);

    // 2. Interpreter Layer
    let interpretation: OrderIntent | null = null;
    let interpretationValid = true;
    let rawLlmOutput: string | null = null;
    let llmError: string | null = null;
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd = 0;

    try {
      const res = await this.deps.interpreter.interpretWithMetrics(message.content);
      interpretation = res.intent;
      rawLlmOutput = res.rawOutput ?? JSON.stringify(res.intent);
      tokensIn = res.metrics.inputTokens;
      tokensOut = res.metrics.outputTokens;
      costUsd = res.metrics.costUsd;
    } catch (err) {
      interpretationValid = false;
      if (err instanceof InterpreterError) {
        llmError = err.message;
        rawLlmOutput = err.rawOutput ?? null;
        if (err.metrics) {
          tokensIn = err.metrics.inputTokens;
          tokensOut = err.metrics.outputTokens;
          costUsd = err.metrics.costUsd;
        }
      } else {
        llmError = (err as Error).message;
      }
    }

    // 3. Fact Resolution
    let toolFailureReason: DecisionReason | null = null;
    let customerRecords: CustomerRecord[] = [];
    let customerAmbiguous = false;
    let productRecords: ProductRecord[] = [];
    let productAmbiguous = false;
    let stockCount: number | null = null;
    let unitPrice: number | null = null;

    if (interpretationValid && interpretation) {
      // Customer resolution: Sender first, then reference
      try {
        const bySender = await this.deps.customerRepo.findBySender(message.sender, overrides.failCustomer);
        if (bySender.length === 1) {
          customerRecords = bySender;
        } else if (bySender.length > 1) {
          customerAmbiguous = true;
        } else if (interpretation.customerReference) {
          const byRef = await this.deps.customerRepo.findByReference(interpretation.customerReference, overrides.failCustomer);
          if (byRef.length === 1) customerRecords = byRef;
          else if (byRef.length > 1) customerAmbiguous = true;
        }
      } catch (err) {
        toolFailureReason = this.mapToolError(err);
      }

      // Product resolution
      if (!toolFailureReason && interpretation.productReference) {
        try {
          const matches = await this.deps.productRepo.search(interpretation.productReference, overrides.failProduct);
          if (matches.length === 1) {
            productRecords = matches;
          } else if (matches.length > 1) {
            productRecords = matches;
            productAmbiguous = true;
          }
        } catch (err) {
          toolFailureReason = this.mapToolError(err);
        }
      }

      // Inventory resolution
      if (!toolFailureReason && productRecords.length === 1 && !productAmbiguous) {
        try {
          stockCount = await this.deps.inventoryRepo.getStock(productRecords[0]!.id, overrides.failStock);
        } catch (err) {
          toolFailureReason = this.mapToolError(err);
        }
      }

      // Pricing resolution
      if (!toolFailureReason && customerRecords.length === 1 && productRecords.length === 1 && !customerAmbiguous && !productAmbiguous) {
        try {
          unitPrice = await this.deps.pricingRepo.getUnitPrice(
            customerRecords[0]!.id,
            productRecords[0]!.id,
            overrides.failPricing
          );
        } catch (err) {
          toolFailureReason = this.mapToolError(err);
        }
      }
    }

    // 4. Deterministic Policy Engine
    const policyResult = evaluatePolicy({
      isDuplicate: false,
      interpretationValid,
      intent: interpretation?.intent ?? 'UNKNOWN',
      toolFailureReason,
      customerResolution: { records: customerRecords, ambiguous: customerAmbiguous },
      productResolution: { records: productRecords, ambiguous: productAmbiguous },
      quantity: interpretation?.quantity ?? null,
      price: unitPrice,
      stock: stockCount,
    });

    // 5. Decision Advisor
    let advisorResult: AdvisorRecommendation;
    try {
      advisorResult = await this.deps.advisor.advise(
        {
          isDuplicate: false,
          interpretationValid,
          intent: interpretation?.intent ?? 'UNKNOWN',
          toolFailureReason,
          customerResolution: { records: customerRecords, ambiguous: customerAmbiguous },
          productResolution: { records: productRecords, ambiguous: productAmbiguous },
          quantity: interpretation?.quantity ?? null,
          price: unitPrice,
          stock: stockCount,
        },
        policyResult
      );
    } catch {
      advisorResult = {
        provider: 'deterministic',
        recommendation: 'NEEDS_HUMAN_REVIEW',
        notes: 'Advisor invocation failed; fell back to safe human review.',
      };
    }

    // 6. Action Execution
    const actionKey = `act_${fingerprint}_${policyResult.action}`;
    const actionOutcome = await executeAction(
      this.deps.messagingService,
      message.sender,
      {
        action: policyResult.action,
        reason: policyResult.reason,
        customer: customerRecords[0] || null,
        product: productRecords[0] || null,
        quantity: interpretation?.quantity ?? null,
        unitPrice,
        language: interpretation?.language ?? 'vi',
      },
      actionKey,
      overrides.failMessaging
    );

    // 7. Audit Record Creation
    const latencyMs = Date.now() - startTime;
    const finalRecord: DecisionRecord = {
      runId,
      messageId: message.id,
      fingerprint,
      receivedAt: message.receivedAt,
      input: { source: message.source, sender: message.sender, content: message.content },
      llmOutput: {
        rawText: rawLlmOutput,
        error: llmError,
      },
      interpretation,
      resolution: {
        customer: customerRecords[0] || null,
        products: productRecords,
        stock: stockCount,
        unitPrice,
      },
      policyChecks: policyResult.policyChecks,
      advisor: {
        provider: advisorResult.provider,
        recommendation: advisorResult.recommendation,
        notes: advisorResult.notes,
      },
      decision: {
        action: policyResult.action,
        reason: policyResult.reason,
      },
      action: actionOutcome,
      metrics: {
        latencyMs,
        inputTokens: tokensIn,
        outputTokens: tokensOut,
        costUsd,
      },
    };

    saveDecisionRecord(this.deps.db, finalRecord);
    return finalRecord;
  }

  private mapToolError(err: unknown): DecisionReason {
    if (err instanceof ToolTimeoutError) return DecisionReasons.TOOL_TIMEOUT;
    if (err instanceof ToolMalformedError) return DecisionReasons.MALFORMED_TOOL_RESPONSE;
    return DecisionReasons.TOOL_ERROR;
  }
}
