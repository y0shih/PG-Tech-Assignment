import { createServer } from 'node:http';
import dotenv from 'dotenv';
import { initDatabase } from '../infrastructure/db.js';
import { JsonCustomerRepository } from '../tools/customers.js';
import { JsonProductRepository } from '../tools/products.js';
import { JsonInventoryRepository } from '../tools/inventory.js';
import { JsonPricingRepository } from '../tools/pricing.js';
import { MockMessagingService } from '../tools/messaging.js';
import { createInterpreter } from '../agent/anthropic-interpreter.js';
import { createAdvisor } from '../advisors/jev-advisor.js';
import { OrderDeskPipeline } from '../application/pipeline.js';
import { buildApiHandler } from './routes.js';

dotenv.config();

export function startServer(
  port: number = parseInt(process.env.PORT || '3000', 10),
  dbPath: string = process.env.DB_PATH || 'order_desk.db'
) {
  const db = initDatabase(dbPath);

  const pipeline = new OrderDeskPipeline({
    db,
    customerRepo: new JsonCustomerRepository(),
    productRepo: new JsonProductRepository(),
    inventoryRepo: new JsonInventoryRepository(),
    pricingRepo: new JsonPricingRepository(),
    messagingService: new MockMessagingService(),
    interpreter: createInterpreter(),
    advisor: createAdvisor(),
  });

  const server = createServer(buildApiHandler(pipeline, db));

  server.listen(port, () => {
    console.log(`Order Desk Agent API listening on http://localhost:${port}`);
  });

  return server;
}

if (!process.env.VITEST) {
  startServer();
}
