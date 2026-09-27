import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { OrderDeskPipeline } from '../application/pipeline.js';
import { getDecisionRecord, listDecisionRecords, clearDatabase } from '../infrastructure/db.js';
import { renderDashboardHtml } from './html.js';
import { runEvalCases } from '../../eval/runner.js';



export function buildApiHandler(pipeline: OrderDeskPipeline, db: DatabaseSync) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'POST' && url.pathname === '/v1/orders/process') {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', async () => {
        let payload: any;
        try {
          payload = JSON.parse(bodyStr || '{}');
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
          return;
        }

        try {
          if (!payload.messageId || !payload.sender || !payload.content) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'messageId, sender, and content are required' }));
            return;
          }

          const record = await pipeline.processMessage({
            id: payload.messageId,
            source: payload.source || 'zalo',
            sender: payload.sender,
            content: payload.content,
            receivedAt: payload.receivedAt || new Date().toISOString(),
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            decisionId: `dec_${record.runId}`,
            action: record.decision.action,
            reason: record.decision.reason,
            runId: record.runId,
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderDashboardHtml());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/decisions') {
      try {
        const records = listDecisionRecords(db, 100);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(records));
        return;
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/decisions/clear') {
      try {
        clearDatabase(db);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'cleared' }));
        return;
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
        return;
      }
    }

    if (req.method === 'GET' && url.pathname === '/v1/catalog') {
      try {
        const productsPath = path.resolve(process.cwd(), 'data/products.json');
        const customersPath = path.resolve(process.cwd(), 'data/customers.json');
        const products = JSON.parse(readFileSync(productsPath, 'utf8'));
        const customers = JSON.parse(readFileSync(customersPath, 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ products, customers }));
        return;
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/eval/run') {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', async () => {
        let advisor = 'deterministic';
        try {
          if (bodyStr.trim()) {
            const parsed = JSON.parse(bodyStr);
            if (parsed.advisor) advisor = parsed.advisor;
          }
        } catch {}

        try {
          const report = await runEvalCases(advisor);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(report));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/v1/decisions/')) {
      const rawId = url.pathname.replace('/v1/decisions/', '').trim();
      const runId = rawId.replace(/^dec_/, '');
      try {
        const record = getDecisionRecord(db, runId);
        if (!record) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Decision record not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(record));
        return;
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };
}
