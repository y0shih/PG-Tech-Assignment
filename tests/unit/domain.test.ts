import { describe, it, expect } from 'vitest';
import { OrderIntentSchema } from '../../src/domain/models.js';
import { ToolTimeoutError, ToolMalformedError } from '../../src/domain/errors.js';
import { DecisionReasons } from '../../src/domain/decisions.js';

describe('Domain Models & Errors', () => {
  it('should validate a valid OrderIntent', () => {
    const raw = {
      intent: 'ORDER',
      customerReference: 'ABC',
      productReference: 'ly 500ml',
      quantity: 5,
      language: 'vi'
    };
    const parsed = OrderIntentSchema.parse(raw);
    expect(parsed.quantity).toBe(5);
  });

  it('should reject invalid OrderIntent with negative quantity', () => {
    const raw = {
      intent: 'ORDER',
      customerReference: null,
      productReference: 'ly 500ml',
      quantity: -1,
      language: 'vi'
    };
    expect(() => OrderIntentSchema.parse(raw)).toThrow();
  });

  it('should instantiate typed tool errors', () => {
    const timeoutErr = new ToolTimeoutError('pricing', 2000);
    expect(timeoutErr.name).toBe('ToolTimeoutError');
    expect(timeoutErr.toolName).toBe('pricing');
    expect(timeoutErr.timeoutMs).toBe(2000);

    const malformedErr = new ToolMalformedError('customer', 'Missing id');
    expect(malformedErr.name).toBe('ToolMalformedError');
  });

  it('should contain all required decision reasons', () => {
    expect(DecisionReasons.ORDER_READY).toBe('ORDER_READY');
    expect(DecisionReasons.CUSTOMER_ON_CREDIT_HOLD).toBe('CUSTOMER_ON_CREDIT_HOLD');
    expect(DecisionReasons.STOCK_INSUFFICIENT).toBe('STOCK_INSUFFICIENT');
  });
});
