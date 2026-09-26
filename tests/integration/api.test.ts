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

  beforeAll(async () => {
    const db = initDatabase(':memory:');
    const pipeline = new OrderDeskPipeline({
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
    await new Promise<void>((resolve) => server.close(resolve));
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

  it('should return 404 for unknown route', async () => {
    const res = await fetch(`${baseUrl}/v1/nonexistent`);
    expect(res.status).toBe(404);
  });
});
