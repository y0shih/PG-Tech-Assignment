import type { CustomerRecord, OrderIntent, ProductRecord } from './models.js';

export type ActionType = 'QUOTE' | 'ASK' | 'ESCALATE' | 'DO_NOTHING';

export const DecisionReasons = {
  ORDER_READY: 'ORDER_READY',
  QUANTITY_MISSING: 'QUANTITY_MISSING',
  PRODUCT_AMBIGUOUS: 'PRODUCT_AMBIGUOUS',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  CUSTOMER_AMBIGUOUS: 'CUSTOMER_AMBIGUOUS',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  CUSTOMER_ON_CREDIT_HOLD: 'CUSTOMER_ON_CREDIT_HOLD',
  STOCK_INSUFFICIENT: 'STOCK_INSUFFICIENT',
  STOCK_UNAVAILABLE: 'STOCK_UNAVAILABLE',
  PRICING_UNAVAILABLE: 'PRICING_UNAVAILABLE',
  DUPLICATE_MESSAGE: 'DUPLICATE_MESSAGE',
  TOOL_TIMEOUT: 'TOOL_TIMEOUT',
  TOOL_ERROR: 'TOOL_ERROR',
  MALFORMED_TOOL_RESPONSE: 'MALFORMED_TOOL_RESPONSE',
  MODEL_OUTPUT_INVALID: 'MODEL_OUTPUT_INVALID',
  UNSUPPORTED_REQUEST: 'UNSUPPORTED_REQUEST',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
} as const;

export type DecisionReason = typeof DecisionReasons[keyof typeof DecisionReasons];

export interface DecisionRecord {
  runId: string;
  messageId: string;
  fingerprint: string;
  receivedAt: string;
  input: {
    source: string;
    sender: string;
    content: string;
  };
  interpretation: OrderIntent | null;
  resolution: {
    customer: CustomerRecord | null;
    products: ProductRecord[];
    stock: number | null;
    unitPrice: number | null;
  };
  policyChecks: Record<string, boolean>;
  advisor: {
    provider: 'deterministic' | 'jev';
    recommendation: string;
    notes?: string;
  };
  decision: {
    action: ActionType;
    reason: DecisionReason;
  };
  action: {
    executed: boolean;
    outboundMessage?: string;
    idempotencyKey?: string;
  };
  metrics: {
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}
