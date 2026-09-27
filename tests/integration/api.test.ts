import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { buildApiHandler } from '../../src/api/routes.js';
import { OrderDeskPipeline } from '../../src/application/pipeline.js';
import { initDatabase } from '../../src/infrastructure/db.js';
import { JsonCustomerRepository } from '../../src/tools/customers.js';
import { JsonProductRepository } from '../../src/tools/products.js';
import { JsonInventoryRepository } from '../../src/tools/inventory.js';
import { JsonPricingRepository } from '../../src/tools/pricing.js';
import { MockMessagingService } from '../../src/tools/messaging.js';
import { MockInterpreter } from '../../src/agent/mock-interpreter.js';
import { DeterministicAdvisor } from '../../src/advisors/deterministic-advisor.js';

describe('HTTP API Endpoints', () => {
  let server: any;
  let baseUrl: string;
  let pipeline: OrderDeskPipeline;

  beforeAll(async () => {
    const db = initDatabase(':memory:');
    pipeline = new OrderDeskPipeline({
      db,
      customerRepo: new JsonCustomerRepository(),
      productRepo: new JsonProductRepository(),
      inventoryRepo: new JsonInventoryRepository(),
      pricingRepo: new JsonPricingRepository(),
      messagingService: new MockMessagingService(),
      interpreter: new MockInterpreter(),
      advisor: new DeterministicAdvisor(),
    });

    const handler = buildApiHandler(pipeline, db);
    server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('should process order via POST /v1/orders/process', async () => {
    const res = await fetch(`${baseUrl}/v1/orders/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageId: 'api-msg-01',
        source: 'zalo',
        sender: '0901234567',
        content: 'Cho em 5 thung ly 500ml trong suot nha',
      }),
    });

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.action).toBe('QUOTE');
    expect(body.reason).toBe('ORDER_READY');
    expect(body.runId).toBeDefined();

    // Verify GET /v1/decisions/:id
    const getRes = await fetch(`${baseUrl}/v1/decisions/${body.runId}`);
    expect(getRes.status).toBe(200);
    const record: any = await getRes.json();
    expect(record.runId).toBe(body.runId);
    expect(record.decision.action).toBe('QUOTE');
  });

  it('should return 400 when required fields are missing on POST /v1/orders/process', async () => {
    const res = await fetch(`${baseUrl}/v1/orders/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'incomplete payload',
      }),
    });

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toContain('required');
  });

  it('should return 404 for unknown decision ID', async () => {
    const res = await fetch(`${baseUrl}/v1/decisions/unknown-run-id`);
    expect(res.status).toBe(404);
  });

  it('should return 400 when JSON is malformed on POST /v1/orders/process', async () => {
    const res = await fetch(`${baseUrl}/v1/orders/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json{',
    });

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toBe('Invalid JSON payload');
  });

  it('should support querying decisions with dec_ prefix', async () => {
    const res = await fetch(`${baseUrl}/v1/orders/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageId: 'api-msg-dec-prefix',
        source: 'zalo',
        sender: '0901234567',
        content: 'Cho em 5 thung ly 500ml trong suot nha',
      }),
    });

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.decisionId).toBe(`dec_${body.runId}`);

    // Query with decisionId (having dec_ prefix)
    const getRes = await fetch(`${baseUrl}/v1/decisions/${body.decisionId}`);
    expect(getRes.status).toBe(200);
    const record: any = await getRes.json();
    expect(record.runId).toBe(body.runId);
  });

  it('should return 500 if database read fails on GET /v1/decisions/:id', async () => {
    const mockDb = {
      prepare: () => {
        throw new Error('Database disk image is malformed');
      },
    } as any;
    const errServer = createServer(buildApiHandler(pipeline, mockDb));
    await new Promise<void>((resolve) => errServer.listen(0, resolve));
    const errPort = (errServer.address() as any).port;
    try {
      const res = await fetch(`http://127.0.0.1:${errPort}/v1/decisions/any-id`);
      expect(res.status).toBe(500);
      const body: any = await res.json();
      expect(body.error).toContain('Database disk image is malformed');
    } finally {
      await new Promise<void>((resolve) => errServer.close(() => resolve()));
    }
  });

  it('should return HTML dashboard on GET /', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('Delta Packaging');
    expect(text).toContain('Run Eval');
  });

  it('should list decisions on GET /v1/decisions', async () => {
    const res = await fetch(`${baseUrl}/v1/decisions`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].runId).toBeDefined();
  });

  it('should execute eval suite on POST /v1/eval/run', async () => {
    const res = await fetch(`${baseUrl}/v1/eval/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ advisor: 'deterministic' }),
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.totalCases).toBe(18);
    expect(body.passed).toBe(18);
    expect(body.passRate).toBe('100.0%');
    expect(Array.isArray(body.results)).toBe(true);
  });

  it('should return catalog and customers on GET /v1/catalog', async () => {
    const res = await fetch(`${baseUrl}/v1/catalog`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body.products)).toBe(true);
    expect(Array.isArray(body.customers)).toBe(true);
    expect(body.products.length).toBeGreaterThan(0);
    expect(body.customers.length).toBeGreaterThan(0);
  });

  it('should clear decisions on POST /v1/decisions/clear', async () => {
    const clearRes = await fetch(`${baseUrl}/v1/decisions/clear`, { method: 'POST' });
    expect(clearRes.status).toBe(200);
    const body: any = await clearRes.json();
    expect(body.status).toBe('cleared');

    const listRes = await fetch(`${baseUrl}/v1/decisions`);
    const listBody: any = await listRes.json();
    expect(listBody).toHaveLength(0);
  });

  it('should return 404 for unknown route', async () => {
    const res = await fetch(`${baseUrl}/v1/nonexistent`);
    expect(res.status).toBe(404);
  });
});
