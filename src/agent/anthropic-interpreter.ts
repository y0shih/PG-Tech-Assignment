import Anthropic from '@anthropic-ai/sdk';
import type { OrderIntent } from '../domain/models.js';
import { OrderIntentSchema } from '../domain/models.js';
import { InterpreterError } from '../domain/errors.js';
import type { OrderInterpreter, InterpretationResult } from './interpreter.js';
import { MockInterpreter } from './mock-interpreter.js';
import { buildExtractionPrompt } from './prompts.js';

export class AnthropicInterpreter implements OrderInterpreter {
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new Anthropic({ apiKey: (apiKey || process.env.ORDER_DESK_API_KEY || '').trim() });
    this.model = (model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5').trim();
  }

  async interpret(content: string): Promise<OrderIntent> {
    const res = await this.interpretWithMetrics(content);
    return res.intent;
  }

  async interpretWithMetrics(content: string): Promise<InterpretationResult> {
    const start = Date.now();
    let rawText: string | undefined;
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 300,
        messages: [{ role: 'user', content: buildExtractionPrompt(content) }],
      });

      const inputTokens = response.usage.input_tokens || 0;
      const outputTokens = response.usage.output_tokens || 0;
      // Sonnet 5 estimated pricing: $3 / 1M in, $15 / 1M out
      const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;
      const metrics = {
        inputTokens,
        outputTokens,
        costUsd,
        latencyMs: Date.now() - start,
      };

      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      if (!textBlock || !textBlock.text) {
        const types = response.content.map(b => b.type).join(', ');
        throw new InterpreterError(`Empty or non-text response from Claude (blocks: [${types || 'none'}])`, undefined, metrics);
      }
      rawText = textBlock.text;

      let parsedJson: any;
      try {
        const text = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        parsedJson = JSON.parse(text);
      } catch (err) {
        throw new InterpreterError('Failed to parse JSON response from Claude', textBlock.text, metrics);
      }

      let validated: OrderIntent;
      try {
        validated = OrderIntentSchema.parse(parsedJson);
      } catch (err) {
        throw new InterpreterError(`Schema validation failed: ${(err as Error).message}`, textBlock.text, metrics);
      }

      return {
        intent: validated,
        rawOutput: rawText,
        metrics,
      };
    } catch (err) {
      if (err instanceof InterpreterError) throw err;
      throw new InterpreterError((err as Error).message, rawText);
    }
  }
}

export function createInterpreter(): OrderInterpreter {
  const mode = process.env.INTERPRETER_MODE || 'mock';
  const apiKey = (process.env.ORDER_DESK_API_KEY || '').trim();
  if (mode === 'anthropic' && apiKey) {
    return new AnthropicInterpreter(apiKey);
  }
  return new MockInterpreter();
}
