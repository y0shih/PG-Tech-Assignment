import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { evaluatePolicy } from '../../src/policy/policy-engine.js';
import { DecisionReasons } from '../../src/domain/decisions.js';
import { DeterministicAdvisor } from '../../src/advisors/deterministic-advisor.js';
import { JevAdvisor, createAdvisor } from '../../src/advisors/jev-advisor.js';

describe('Deterministic Policy Engine Precedence', () => {
  const baseContext = {
    isDuplicate: false,
    interpretationValid: true,
    intent: 'ORDER' as const,
    toolFailureReason: null,
    customerResolution: {
      records: [{ id: 'CUST-001', name: 'ABC', phone: '0901', email: 'abc', creditStatus: 'ACTIVE' as const }],
      ambiguous: false,
    },
    productResolution: {
      records: [{ id: 'PROD-001', name: 'Ly 500ml', sku: 'LY', unit: 'thung', stock: 50, basePrice: 120000 }],
      ambiguous: false,
    },
    quantity: 10,
    price: 120000,
    stock: 50,
  };

  it('1. should return DO_NOTHING on duplicate message', () => {
    const res = evaluatePolicy({ ...baseContext, isDuplicate: true });
    expect(res.action).toBe('DO_NOTHING');
    expect(res.reason).toBe(DecisionReasons.DUPLICATE_MESSAGE);
    expect(res.policyChecks.isUnique).toBe(false);
  });

  it('2. should return ESCALATE when interpretation invalid', () => {
    const res = evaluatePolicy({ ...baseContext, interpretationValid: false });
    expect(res.action).toBe('ESCALATE');
    expect(res.reason).toBe(DecisionReasons.MODEL_OUTPUT_INVALID);
    expect(res.policyChecks.interpretationValid).toBe(false);
  });

  it('3. should return DO_NOTHING when intent is not ORDER', () => {
    const otherRes = evaluatePolicy({ ...baseContext, intent: 'OTHER' });
    expect(otherRes.action).toBe('DO_NOTHING');
    expect(otherRes.reason).toBe(DecisionReasons.UNSUPPORTED_REQUEST);

    const unknownRes = evaluatePolicy({ ...baseContext, intent: 'UNKNOWN' });
    expect(unknownRes.action).toBe('DO_NOTHING');
    expect(unknownRes.reason).toBe(DecisionReasons.UNSUPPORTED_REQUEST);
  });

  it('4. should return ESCALATE when tool failure occurred', () => {
    const res = evaluatePolicy({ ...baseContext, toolFailureReason: DecisionReasons.TOOL_TIMEOUT });
    expect(res.action).toBe('ESCALATE');
    expect(res.reason).toBe(DecisionReasons.TOOL_TIMEOUT);
    expect(res.policyChecks.toolsHealthy).toBe(false);
  });

  it('5. should return ESCALATE when customer not found or ambiguous', () => {
    const notFound = evaluatePolicy({ ...baseContext, customerResolution: { records: [], ambiguous: false } });
    expect(notFound.action).toBe('ESCALATE');
    expect(notFound.reason).toBe(DecisionReasons.CUSTOMER_NOT_FOUND);

    const ambiguous = evaluatePolicy({ ...baseContext, customerResolution: { records: [], ambiguous: true } });
    expect(ambiguous.action).toBe('ESCALATE');
    expect(ambiguous.reason).toBe(DecisionReasons.CUSTOMER_AMBIGUOUS);

    const multi = evaluatePolicy({
      ...baseContext,
      customerResolution: {
        records: [
          { id: 'CUST-001', name: 'ABC', phone: '0901', email: 'abc', creditStatus: 'ACTIVE' },
          { id: 'CUST-002', name: 'ABC2', phone: '0902', email: 'abc2', creditStatus: 'ACTIVE' },
        ],
        ambiguous: false,
      },
    });
    expect(multi.action).toBe('ESCALATE');
    expect(multi.reason).toBe(DecisionReasons.CUSTOMER_AMBIGUOUS);
  });

  it('6. should return ESCALATE when customer on credit hold', () => {
    const hold = evaluatePolicy({
      ...baseContext,
      customerResolution: {
        records: [{ id: 'CUST-002', name: 'Hold Co', phone: '0902', email: 'hold', creditStatus: 'CREDIT_HOLD' }],
        ambiguous: false,
      },
    });
    expect(hold.action).toBe('ESCALATE');
    expect(hold.reason).toBe(DecisionReasons.CUSTOMER_ON_CREDIT_HOLD);
    expect(hold.policyChecks.creditApproved).toBe(false);
  });

  it('7. should return ASK when product is ambiguous or not found', () => {
    const notFound = evaluatePolicy({ ...baseContext, productResolution: { records: [], ambiguous: false } });
    expect(notFound.action).toBe('ASK');
    expect(notFound.reason).toBe(DecisionReasons.PRODUCT_NOT_FOUND);

    const ambiguous = evaluatePolicy({ ...baseContext, productResolution: { records: [], ambiguous: true } });
    expect(ambiguous.action).toBe('ASK');
    expect(ambiguous.reason).toBe(DecisionReasons.PRODUCT_AMBIGUOUS);

    const multi = evaluatePolicy({
      ...baseContext,
      productResolution: {
        records: [
          { id: 'PROD-001', name: 'Ly 500ml', sku: 'LY', unit: 'thung', stock: 50, basePrice: 120000 },
          { id: 'PROD-002', name: 'Ly 700ml', sku: 'LY2', unit: 'thung', stock: 50, basePrice: 140000 },
        ],
        ambiguous: false,
      },
    });
    expect(multi.action).toBe('ASK');
    expect(multi.reason).toBe(DecisionReasons.PRODUCT_AMBIGUOUS);
  });

  it('8. should return ASK when quantity is missing or null or non-positive', () => {
    const nullQty = evaluatePolicy({ ...baseContext, quantity: null });
    expect(nullQty.action).toBe('ASK');
    expect(nullQty.reason).toBe(DecisionReasons.QUANTITY_MISSING);

    const zeroQty = evaluatePolicy({ ...baseContext, quantity: 0 });
    expect(zeroQty.action).toBe('ASK');
    expect(zeroQty.reason).toBe(DecisionReasons.QUANTITY_MISSING);

    const negQty = evaluatePolicy({ ...baseContext, quantity: -5 });
    expect(negQty.action).toBe('ASK');
    expect(negQty.reason).toBe(DecisionReasons.QUANTITY_MISSING);
  });

  it('9. should return ESCALATE when price unavailable', () => {
    const res = evaluatePolicy({ ...baseContext, price: null });
    expect(res.action).toBe('ESCALATE');
    expect(res.reason).toBe(DecisionReasons.PRICING_UNAVAILABLE);
    expect(res.policyChecks.priceResolved).toBe(false);
  });

  it('10. should return ESCALATE when stock is unavailable or insufficient', () => {
    const unavail = evaluatePolicy({ ...baseContext, stock: null });
    expect(unavail.action).toBe('ESCALATE');
    expect(unavail.reason).toBe(DecisionReasons.STOCK_UNAVAILABLE);

    const insufficient = evaluatePolicy({ ...baseContext, quantity: 100, stock: 20 });
    expect(insufficient.action).toBe('ESCALATE');
    expect(insufficient.reason).toBe(DecisionReasons.STOCK_INSUFFICIENT);
    expect(insufficient.policyChecks.stockSufficient).toBe(false);
  });

  it('11. should return QUOTE when all rules clear', () => {
    const res = evaluatePolicy(baseContext);
    expect(res.action).toBe('QUOTE');
    expect(res.reason).toBe(DecisionReasons.ORDER_READY);
    expect(res.policyChecks.isUnique).toBe(true);
    expect(res.policyChecks.interpretationValid).toBe(true);
    expect(res.policyChecks.isOrderIntent).toBe(true);
    expect(res.policyChecks.toolsHealthy).toBe(true);
    expect(res.policyChecks.customerResolved).toBe(true);
    expect(res.policyChecks.creditApproved).toBe(true);
    expect(res.policyChecks.productResolved).toBe(true);
    expect(res.policyChecks.quantityValid).toBe(true);
    expect(res.policyChecks.priceResolved).toBe(true);
    expect(res.policyChecks.stockSufficient).toBe(true);
  });

  it('should verify precedence: duplicate check beats invalid interpretation', () => {
    const res = evaluatePolicy({ ...baseContext, isDuplicate: true, interpretationValid: false });
    expect(res.action).toBe('DO_NOTHING');
    expect(res.reason).toBe(DecisionReasons.DUPLICATE_MESSAGE);
  });

  it('should verify precedence: customer failure beats product failure', () => {
    const res = evaluatePolicy({
      ...baseContext,
      customerResolution: { records: [], ambiguous: false },
      productResolution: { records: [], ambiguous: false },
    });
    expect(res.action).toBe('ESCALATE');
    expect(res.reason).toBe(DecisionReasons.CUSTOMER_NOT_FOUND);
  });

  it('should verify precedence: product failure beats missing quantity', () => {
    const res = evaluatePolicy({
      ...baseContext,
      productResolution: { records: [], ambiguous: false },
      quantity: null,
    });
    expect(res.action).toBe('ASK');
    expect(res.reason).toBe(DecisionReasons.PRODUCT_NOT_FOUND);
  });

  it('should test DecisionAdvisor implementations', async () => {
    const detAdvisor = new DeterministicAdvisor();
    const detAdviseQuote = await detAdvisor.advise(baseContext, { action: 'QUOTE', reason: DecisionReasons.ORDER_READY });
    expect(detAdviseQuote.recommendation).toBe('READY_FOR_QUOTE');
    expect(detAdviseQuote.provider).toBe('deterministic');

    const detAdviseAsk = await detAdvisor.advise(baseContext, { action: 'ASK', reason: DecisionReasons.PRODUCT_AMBIGUOUS });
    expect(detAdviseAsk.recommendation).toBe('NEEDS_CLARIFICATION');

    const detAdviseDoNothing = await detAdvisor.advise(baseContext, { action: 'DO_NOTHING', reason: DecisionReasons.DUPLICATE_MESSAGE });
    expect(detAdviseDoNothing.recommendation).toBe('DO_NOTHING');

    const detAdviseEscalate = await detAdvisor.advise(baseContext, { action: 'ESCALATE', reason: DecisionReasons.CUSTOMER_ON_CREDIT_HOLD });
    expect(detAdviseEscalate.recommendation).toBe('NEEDS_HUMAN_REVIEW');

    const jevAdvisor = new JevAdvisor();
    const jevAdviseQuote = await jevAdvisor.advise(baseContext, { action: 'QUOTE', reason: DecisionReasons.ORDER_READY });
    expect(jevAdviseQuote.recommendation).toBe('READY_FOR_QUOTE');
    expect(jevAdviseQuote.provider).toBe('jev');
    expect(jevAdviseQuote.notes).toBeDefined();

    const jevAdviseAsk = await jevAdvisor.advise(baseContext, { action: 'ASK', reason: DecisionReasons.PRODUCT_AMBIGUOUS });
    expect(jevAdviseAsk.recommendation).toBe('NEEDS_CLARIFICATION');

    const jevAdviseDoNothing = await jevAdvisor.advise(baseContext, { action: 'DO_NOTHING', reason: DecisionReasons.DUPLICATE_MESSAGE });
    expect(jevAdviseDoNothing.recommendation).toBe('DO_NOTHING');

    const jevAdviseEscalate = await jevAdvisor.advise(baseContext, { action: 'ESCALATE', reason: DecisionReasons.CUSTOMER_ON_CREDIT_HOLD });
    expect(jevAdviseEscalate.recommendation).toBe('NEEDS_HUMAN_REVIEW');
  });

  describe('createAdvisor factory', () => {
    const prevEnv = process.env.DECISION_ADVISOR;

    afterEach(() => {
      process.env.DECISION_ADVISOR = prevEnv;
    });

    it('should create DeterministicAdvisor by default', () => {
      delete process.env.DECISION_ADVISOR;
      const advisor = createAdvisor();
      expect(advisor).toBeInstanceOf(DeterministicAdvisor);
    });

    it('should create JevAdvisor when DECISION_ADVISOR=jev', () => {
      process.env.DECISION_ADVISOR = 'jev';
      const advisor = createAdvisor();
      expect(advisor).toBeInstanceOf(JevAdvisor);
    });
  });
});
