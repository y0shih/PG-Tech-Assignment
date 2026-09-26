import { z } from 'zod';
import { ToolError, ToolMalformedError, ToolTimeoutError } from '../domain/errors.js';

export type FailureInjectionMode = 'none' | 'error' | 'timeout' | 'malformed';

export interface ReliabilityOptions<T> {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  schema?: z.ZodSchema<T> | z.ZodType<T, any, any>;
  injection?: FailureInjectionMode;
}

export async function withReliability<T>(
  toolName: string,
  operation: () => Promise<unknown>,
  options: ReliabilityOptions<T> & { schema: z.ZodSchema<T> | z.ZodType<T, any, any> }
): Promise<T>;
export async function withReliability<T>(
  toolName: string,
  operation: () => Promise<T>,
  options?: ReliabilityOptions<T>
): Promise<T>;
export async function withReliability<T>(
  toolName: string,
  operation: () => Promise<any>,
  options: ReliabilityOptions<T> = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const retries = options.retries ?? 2;
  const backoffMs = options.backoffMs ?? 100;
  const envKey = toolName.toUpperCase();
  const injection =
    options.injection ??
    ((process.env[`FAIL_${envKey}_LOOKUP`] || process.env[`FAIL_${envKey}`]) as FailureInjectionMode) ??
    'none';

  if (injection === 'timeout') {
    throw new ToolTimeoutError(toolName, timeoutMs);
  }
  if (injection === 'error') {
    throw new ToolError(toolName, 'Injected system error');
  }
  if (injection === 'malformed') {
    throw new ToolMalformedError(toolName, 'Injected malformed response payload');
  }

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    let timerId: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timerId = setTimeout(() => reject(new ToolTimeoutError(toolName, timeoutMs)), timeoutMs);
        })
      ]).finally(() => {
        if (timerId) clearTimeout(timerId);
      });

      if (options.schema) {
        const parsed = options.schema.safeParse(result);
        if (!parsed.success) {
          throw new ToolMalformedError(toolName, parsed.error.message);
        }
        return parsed.data;
      }

      return result;
    } catch (err) {
      lastError = err;
      if (err instanceof ToolMalformedError || err instanceof ToolTimeoutError) {
        throw err;
      }
      attempt++;
      if (attempt <= retries) {
        await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt - 1)));
      }
    }
  }

  if (lastError instanceof ToolError) throw lastError;
  throw new ToolError(toolName, (lastError as Error)?.message || 'Unknown tool failure');
}
