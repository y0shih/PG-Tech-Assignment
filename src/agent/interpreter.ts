import type { OrderIntent } from '../domain/models.js';

export interface InterpretationMetrics {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface InterpretationResult {
  intent: OrderIntent;
  metrics: InterpretationMetrics;
}

export interface OrderInterpreter {
  interpret(content: string): Promise<OrderIntent>;
  interpretWithMetrics(content: string): Promise<InterpretationResult>;
}
