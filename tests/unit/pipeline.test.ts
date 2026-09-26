import { describe, it, expect, beforeEach } from 'vitest';
import { OrderDeskPipeline } from '../../src/application/pipeline.js';
import { formatOutboundMessage, executeAction } from '../../src/application/action-executor.js';
import { initDatabase, getDecisionRecord } from '../../src/infrastructure/db.js';
import { JsonCustomerRepository } from '../../src/tools/customers.js';
import { JsonProductRepository } from '../../src/tools/products.js';
import { JsonInventoryRepository } from '../../src/tools/inventory.js';
import { JsonPricingRepository } from '../../src/tools/pricing.js';
import { MockMessagingService } from '../../src/tools/messaging.js';
import { MockInterpreter } from '../../src/agent/mock-interpreter.js';
import { DeterministicAdvisor } from '../../src/advisors/deterministic-advisor.js';
import { DecisionReasons } from '../../src/domain/decisions.js';

describe('OrderDeskPipeline', () => {
  let pipeline: OrderDeskPipeline;
  let db: any;
  let messagingService: MockMessagingService;

  beforeEach(() => {
    db = initDatabase(':memory:');
    messagingService = new MockMessagingService();
    pipeline = new OrderDeskPipeline({
      db,
      customerRepo: new JsonCustomerRepository(),
      productRepo: new JsonProductRepository(),
      inventoryRepo: new JsonInventoryRepository(),
      pricingRepo: new JsonPricingRepository(),
      messagingService,
      interpreter: new MockInterpreter(),
      advisor: new DeterministicAdvisor(),
    });
  });

  it('should process a valid Vietnamese order and produce a QUOTE decision', async () => {
    const record = await pipeline.processMessage({
      id: 'msg-vn-01',
      source: 'zalo',
      sender: '0901234567',
      content: 'Chị lấy giúp em 5 thùng ly 500ml trong suốt nha',
      receivedAt: new Date().toISOString(),
    });

    expect(record.decision.action).toBe('QUOTE');
    expect(record.decision.reason).toBe('ORDER_READY');
    expect(record.action.executed).toBe(true);
    expect(record.action.outboundMessage).toContain('120.000');
    expect(record.action.outboundMessage).toContain('600.000');

    // Verify persisted to DB
    const saved = getDecisionRecord(db, record.runId);
    expect(saved).not.toBeNull();
    expect(saved?.runId).toBe(record.runId);
    expect(saved?.decision.action).toBe('QUOTE');
  });

  it('should suppress duplicate message on second execution', async () => {
    const msg = {
      id: 'msg-dup-01',
      source: 'zalo' as const,
      sender: '0901234567',
      content: 'Chị lấy 5 thùng ly 500ml trong suốt nha',
      receivedAt: new Date().toISOString(),
    };

    const first = await pipeline.processMessage(msg);
    expect(first.decision.action).toBe('QUOTE');

    const second = await pipeline.processMessage(msg);
    expect(second.decision.action).toBe('DO_NOTHING');
    expect(second.decision.reason).toBe('DUPLICATE_MESSAGE');
    expect(second.action.executed).toBe(false);
  });

  it('should escalate when customer is on credit hold', async () => {
    const record = await pipeline.processMessage({
      id: 'msg-hold-01',
      source: 'email',
      sender: 'sg1@coffee.vn',
      content: 'Order 5 cartons of ly nhựa 500ml trong suốt',
      receivedAt: new Date().toISOString(),
    });

    expect(record.decision.action).toBe('ESCALATE');
    expect(record.decision.reason).toBe('CUSTOMER_ON_CREDIT_HOLD');
    expect(record.action.executed).toBe(false);
  });

  it('should ask for quantity if missing from inbound message', async () => {
    const record = await pipeline.processMessage({
      id: 'msg-no-qty-01',
      source: 'zalo',
      sender: '0901234567',
      content: 'Chị lấy giúp em ly 500ml trong suốt nha',
      receivedAt: new Date().toISOString(),
    });

    expect(record.decision.action).toBe('ASK');
    expect(record.decision.reason).toBe(DecisionReasons.QUANTITY_MISSING);
    expect(record.action.executed).toBe(true);
    expect(record.action.outboundMessage).toContain('số lượng cần đặt');
  });

  it('should ask for clarification when product is ambiguous', async () => {
    const record = await pipeline.processMessage({
      id: 'msg-ambig-prod-01',
      source: 'zalo',
      sender: '0901234567',
      content: 'Chị lấy giúp em 5 thùng ly 500ml nha',
      receivedAt: new Date().toISOString(),
    });

    expect(record.decision.action).toBe('ASK');
    expect(record.decision.reason).toBe(DecisionReasons.PRODUCT_AMBIGUOUS);
    expect(record.action.executed).toBe(true);
    expect(record.action.outboundMessage).toContain('nhiều sản phẩm');
  });

  it('should handle tool failure gracefully and map to decision reason', async () => {
    const record = await pipeline.processMessage(
      {
        id: 'msg-timeout-01',
        source: 'zalo',
        sender: '0901234567',
        content: 'Chị lấy giúp em 5 thùng ly 500ml trong suốt nha',
        receivedAt: new Date().toISOString(),
      },
      { failCustomer: 'timeout' }
    );

    expect(record.decision.action).toBe('ESCALATE');
    expect(record.decision.reason).toBe(DecisionReasons.TOOL_TIMEOUT);
    expect(record.action.executed).toBe(false);
  });

  it('should support English quotes format', async () => {
    const record = await pipeline.processMessage({
      id: 'msg-en-01',
      source: 'email',
      sender: 'abc@milktea.vn',
      content: 'Please send 5 cartons of kraft paper box quote',
      receivedAt: new Date().toISOString(),
    });

    expect(record.decision.action).toBe('QUOTE');
    expect(record.action.outboundMessage).toContain('Delta Packaging Quote:');
    expect(record.action.outboundMessage).toContain('thùng');
    expect(record.action.outboundMessage).toContain('Reply to confirm order.');
  });

  it('should escalate when stock is insufficient', async () => {
    // PROD-005 (túi zipper 30x40cm) only has stock of 2
    const record = await pipeline.processMessage({
      id: 'msg-stock-01',
      source: 'zalo',
      sender: '0901234567',
      content: 'Chị lấy giúp em 10 kg túi zipper 30x40 nha',
      receivedAt: new Date().toISOString(),
    });

    expect(record.decision.action).toBe('ESCALATE');
    expect(record.decision.reason).toBe(DecisionReasons.STOCK_INSUFFICIENT);
    expect(record.action.executed).toBe(false);
  });

  it('should ask customer when product is not in catalog', async () => {
    const record = await pipeline.processMessage({
      id: 'msg-not-found-01',
      source: 'zalo',
      sender: '0901234567',
      content: 'Chị lấy giúp em 5 thùng băng keo nha',
      receivedAt: new Date().toISOString(),
    });

    expect(record.decision.action).toBe('ASK');
    expect(record.decision.reason).toBe(DecisionReasons.PRODUCT_NOT_FOUND);
    expect(record.action.executed).toBe(true);
    expect(record.action.outboundMessage).toContain('chưa có trong danh mục');
  });

  it('should return DO_NOTHING for non-order general inquiries', async () => {
    const record = await pipeline.processMessage({
      id: 'msg-greeting-01',
      source: 'zalo',
      sender: '0901234567',
      content: 'Chào chị buổi sáng tốt lành',
      receivedAt: new Date().toISOString(),
    });

    expect(record.decision.action).toBe('DO_NOTHING');
    expect(record.decision.reason).toBe(DecisionReasons.UNSUPPORTED_REQUEST);
    expect(record.action.executed).toBe(false);
  });

  it('should escalate when interpreter throws error', async () => {
    const brokenPipeline = new OrderDeskPipeline({
      db,
      customerRepo: new JsonCustomerRepository(),
      productRepo: new JsonProductRepository(),
      inventoryRepo: new JsonInventoryRepository(),
      pricingRepo: new JsonPricingRepository(),
      messagingService,
      interpreter: {
        interpret: async () => { throw new Error('Model timeout'); },
        interpretWithMetrics: async () => { throw new Error('Model timeout'); },
      },
      advisor: new DeterministicAdvisor(),
    });

    const record = await brokenPipeline.processMessage({
      id: 'msg-broken-model-01',
      source: 'zalo',
      sender: '0901234567',
      content: 'Lấy 5 thùng ly',
      receivedAt: new Date().toISOString(),
    });

    expect(record.decision.action).toBe('ESCALATE');
    expect(record.decision.reason).toBe(DecisionReasons.MODEL_OUTPUT_INVALID);
    expect(record.action.executed).toBe(false);
  });

  it('should map malformed tool responses and generic tool errors', async () => {
    const malformedRecord = await pipeline.processMessage(
      {
        id: 'msg-malformed-01',
        source: 'zalo',
        sender: '0901234567',
        content: 'Chị lấy giúp em 5 thùng ly 500ml trong suốt nha',
        receivedAt: new Date().toISOString(),
      },
      { failProduct: 'malformed' }
    );
    expect(malformedRecord.decision.action).toBe('ESCALATE');
    expect(malformedRecord.decision.reason).toBe(DecisionReasons.MALFORMED_TOOL_RESPONSE);

    const errorRecord = await pipeline.processMessage(
      {
        id: 'msg-err-01',
        source: 'zalo',
        sender: '0901234567',
        content: 'Chị lấy giúp em 3 thùng ly 500ml trong suốt nha',
        receivedAt: new Date().toISOString(),
      },
      { failPricing: 'error' }
    );
    expect(errorRecord.decision.action).toBe('ESCALATE');
    expect(errorRecord.decision.reason).toBe(DecisionReasons.TOOL_ERROR);
  });

  it('should handle messaging failure gracefully without breaking pipeline', async () => {
    const record = await pipeline.processMessage(
      {
        id: 'msg-fail-msg-01',
        source: 'zalo',
        sender: '0901234567',
        content: 'Chị lấy giúp em 5 thùng ly 500ml trong suốt nha',
        receivedAt: new Date().toISOString(),
      },
      { failMessaging: 'error' }
    );

    expect(record.decision.action).toBe('QUOTE');
    expect(record.action.executed).toBe(false);
  });

  it('should fall back to safe human review recommendation when advisor throws error', async () => {
    const failingAdvisorPipeline = new OrderDeskPipeline({
      db,
      customerRepo: new JsonCustomerRepository(),
      productRepo: new JsonProductRepository(),
      inventoryRepo: new JsonInventoryRepository(),
      pricingRepo: new JsonPricingRepository(),
      messagingService,
      interpreter: new MockInterpreter(),
      advisor: {
        advise: async () => {
          throw new Error('LLM Advisor Service Unavailable');
        },
      },
    });

    const record = await failingAdvisorPipeline.processMessage({
      id: 'msg-failing-advisor-01',
      source: 'zalo',
      sender: '0901234567',
      content: 'Chị lấy giúp em 2 thùng ly 500ml trong suốt nha',
      receivedAt: new Date().toISOString(),
    });

    expect(record.advisor.provider).toBe('deterministic');
    expect(record.advisor.recommendation).toBe('NEEDS_HUMAN_REVIEW');
    expect(record.advisor.notes).toContain('Advisor invocation failed');
    // Policy decision still proceeds
    expect(record.decision.action).toBe('QUOTE');
    expect(record.action.executed).toBe(true);
    // Audit record still persisted
    const saved = getDecisionRecord(db, record.runId);
    expect(saved).not.toBeNull();
    expect(saved?.advisor.recommendation).toBe('NEEDS_HUMAN_REVIEW');
  });

  it('should support processOrder alias identically to processMessage', async () => {
    const record = await pipeline.processOrder({
      id: 'msg-alias-01',
      source: 'zalo',
      sender: '0901234567',
      content: 'Chị lấy giúp em 4 thùng ly 500ml trong suốt nha',
      receivedAt: new Date().toISOString(),
    });

    expect(record.decision.action).toBe('QUOTE');
    expect(record.action.executed).toBe(true);
    expect(record.runId).toBeDefined();
  });
});

describe('Action Executor formatting & execution', () => {
  it('formats outbound messages correctly for all action types and languages', () => {
    const dummyProduct = {
      id: 'prod-001',
      name: 'Ly nhựa 500ml',
      sku: 'LY-500-PP',
      unit: 'thùng',
      stock: 50,
      basePrice: 120000,
    };

    // Vietnamese quote
    const viQuote = formatOutboundMessage({
      action: 'QUOTE',
      reason: DecisionReasons.ORDER_READY,
      customer: null,
      product: dummyProduct,
      quantity: 5,
      unitPrice: 120000,
      language: 'vi',
    });
    expect(viQuote).toContain('Delta Packaging kính gửi báo giá');
    expect(viQuote).toContain('600.000 đ');

    // English quote
    const enQuote = formatOutboundMessage({
      action: 'QUOTE',
      reason: DecisionReasons.ORDER_READY,
      customer: null,
      product: dummyProduct,
      quantity: 5,
      unitPrice: 120000,
      language: 'en',
    });
    expect(enQuote).toContain('Delta Packaging Quote:');
    expect(enQuote).toContain('Total: 600.000 VND');

    // ASK product not found in English
    const enAskNotFound = formatOutboundMessage({
      action: 'ASK',
      reason: DecisionReasons.PRODUCT_NOT_FOUND,
      customer: null,
      product: null,
      quantity: 5,
      unitPrice: null,
      language: 'en',
    });
    expect(enAskNotFound).toContain('could not find the requested product');

    // ESCALATE produces no outbound message
    const escalateMsg = formatOutboundMessage({
      action: 'ESCALATE',
      reason: DecisionReasons.CUSTOMER_ON_CREDIT_HOLD,
      customer: null,
      product: null,
      quantity: null,
      unitPrice: null,
      language: 'vi',
    });
    expect(escalateMsg).toBeNull();
  });
});
