export class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplicationError';
  }
}

export class ToolError extends ApplicationError {
  constructor(public readonly toolName: string, message: string) {
    super(`Tool [${toolName}] error: ${message}`);
    this.name = 'ToolError';
  }
}

export class ToolTimeoutError extends ToolError {
  constructor(toolName: string, public readonly timeoutMs: number) {
    super(toolName, `Operation timed out after ${timeoutMs}ms`);
    this.name = 'ToolTimeoutError';
  }
}

export class ToolMalformedError extends ToolError {
  constructor(toolName: string, public readonly details: string) {
    super(toolName, `Response malformed: ${details}`);
    this.name = 'ToolMalformedError';
  }
}

export class InterpreterError extends ApplicationError {
  constructor(
    message: string,
    public readonly rawOutput?: string,
    public readonly metrics?: { inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number }
  ) {
    super(`Interpreter error: ${message}`);
    this.name = 'InterpreterError';
  }
}
