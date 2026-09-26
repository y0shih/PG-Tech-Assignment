import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { OrderDeskPipeline } from '../application/pipeline.js';
import { getDecisionRecord } from '../infrastructure/db.js';

export function buildApiHandler(pipeline: OrderDeskPipeline, db: DatabaseSync) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'POST' && url.pathname === '/v1/orders/process') {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(bodyStr || '{}');
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

    if (req.method === 'GET' && url.pathname.startsWith('/v1/decisions/')) {
      const id = url.pathname.replace('/v1/decisions/', '').trim();
      const record = getDecisionRecord(db, id);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Decision record not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(record));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };
}
