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
    this.client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
    this.model = model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  }

  async interpret(content: string): Promise<OrderIntent> {
    const res = await this.interpretWithMetrics(content);
    return res.intent;
  }

  async interpretWithMetrics(content: string): Promise<InterpretationResult> {
    const start = Date.now();
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 300,
        messages: [{ role: 'user', content: buildExtractionPrompt(content) }],
      });

      const block = response.content[0];
      if (!block || block.type !== 'text') {
        throw new InterpreterError('Empty or non-text response from Claude');
      }

      let parsedJson: any;
      try {
        const text = block.text.trim().replace(/^```json/i, '').replace(/```$/i, '').trim();
        parsedJson = JSON.parse(text);
      } catch (err) {
        throw new InterpreterError('Failed to parse JSON response from Claude', block.text);
      }

      const validated = OrderIntentSchema.parse(parsedJson);

      const inputTokens = response.usage.input_tokens || 0;
      const outputTokens = response.usage.output_tokens || 0;
      // Sonnet 5 estimated pricing: $3 / 1M in, $15 / 1M out
      const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

      return {
        intent: validated,
        metrics: {
          inputTokens,
          outputTokens,
          costUsd,
          latencyMs: Date.now() - start,
        }
      };
    } catch (err) {
      if (err instanceof InterpreterError) throw err;
      throw new InterpreterError((err as Error).message);
    }
  }
}

export function createInterpreter(): OrderInterpreter {
  const mode = process.env.INTERPRETER_MODE || 'mock';
  if (mode === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    return new AnthropicInterpreter();
  }
  return new MockInterpreter();
}
