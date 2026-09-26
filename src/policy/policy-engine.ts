import { DecisionReasons } from '../domain/decisions.js';
import type { PolicyContext, PolicyEvaluationResult } from './rules.js';

export function evaluatePolicy(ctx: PolicyContext): PolicyEvaluationResult {
  const policyChecks: Record<string, boolean> = {
    isUnique: !ctx.isDuplicate,
    interpretationValid: ctx.interpretationValid,
    isOrderIntent: ctx.intent === 'ORDER',
    toolsHealthy: ctx.toolFailureReason === null,
    customerResolved: ctx.customerResolution.records.length === 1 && !ctx.customerResolution.ambiguous,
    creditApproved: ctx.customerResolution.records[0]?.creditStatus !== 'CREDIT_HOLD',
    productResolved: ctx.productResolution.records.length === 1 && !ctx.productResolution.ambiguous,
    quantityValid: typeof ctx.quantity === 'number' && ctx.quantity > 0,
    priceResolved: ctx.price !== null,
    stockSufficient: ctx.stock !== null && typeof ctx.quantity === 'number' && ctx.stock >= ctx.quantity,
  };

  // 1. Duplicate check
  if (ctx.isDuplicate) {
    return { action: 'DO_NOTHING', reason: DecisionReasons.DUPLICATE_MESSAGE, policyChecks };
  }

  // 2. Model interpretation failure
  if (!ctx.interpretationValid) {
    return { action: 'ESCALATE', reason: DecisionReasons.MODEL_OUTPUT_INVALID, policyChecks };
  }

  // 3. Non-order intent
  if (ctx.intent !== 'ORDER') {
    return { action: 'DO_NOTHING', reason: DecisionReasons.UNSUPPORTED_REQUEST, policyChecks };
  }

  // 4. Tool execution / timeout / malformed failures
  if (ctx.toolFailureReason) {
    return { action: 'ESCALATE', reason: ctx.toolFailureReason, policyChecks };
  }

  // 5. Customer checks
  if (ctx.customerResolution.ambiguous || ctx.customerResolution.records.length > 1) {
    return { action: 'ESCALATE', reason: DecisionReasons.CUSTOMER_AMBIGUOUS, policyChecks };
  }
  if (ctx.customerResolution.records.length === 0) {
    return { action: 'ESCALATE', reason: DecisionReasons.CUSTOMER_NOT_FOUND, policyChecks };
  }
  if (ctx.customerResolution.records[0]?.creditStatus === 'CREDIT_HOLD') {
    return { action: 'ESCALATE', reason: DecisionReasons.CUSTOMER_ON_CREDIT_HOLD, policyChecks };
  }

  // 6. Product checks
  if (ctx.productResolution.ambiguous || ctx.productResolution.records.length > 1) {
    return { action: 'ASK', reason: DecisionReasons.PRODUCT_AMBIGUOUS, policyChecks };
  }
  if (ctx.productResolution.records.length === 0) {
    return { action: 'ASK', reason: DecisionReasons.PRODUCT_NOT_FOUND, policyChecks };
  }

  // 7. Quantity checks
  if (!ctx.quantity || ctx.quantity <= 0) {
    return { action: 'ASK', reason: DecisionReasons.QUANTITY_MISSING, policyChecks };
  }

  // 8. Pricing checks
  if (ctx.price === null) {
    return { action: 'ESCALATE', reason: DecisionReasons.PRICING_UNAVAILABLE, policyChecks };
  }

  // 9. Stock check
  if (ctx.stock === null) {
    return { action: 'ESCALATE', reason: DecisionReasons.STOCK_UNAVAILABLE, policyChecks };
  }
  if (ctx.stock < ctx.quantity) {
    return { action: 'ESCALATE', reason: DecisionReasons.STOCK_INSUFFICIENT, policyChecks };
  }

  // 10. All criteria satisfied
  return { action: 'QUOTE', reason: DecisionReasons.ORDER_READY, policyChecks };
}
