# Delta Packaging Supply — Order Desk Agent POC

Production-shaped Proof of Concept (POC) for Delta Packaging Supply's Order Desk Agent.
Ingests messy inbound messages in Vietnamese/English from Zalo/Email and deterministically outputs exactly one structured decision: `QUOTE`, `ASK`, `ESCALATE`, or `DO_NOTHING`.

## Core Architectural Principle
> **LLM interprets. Tools provide facts. Code enforces policy. Code owns actions.**

* **LLM (Claude Sonnet 5)** parses unstructured text into normalized entity references.
* **Repositories** provide authoritative company facts (customers, products, stock, pricing).
* **Deterministic Policy Engine** evaluates business precedence in code.
* **Decision Advisor** (Deterministic / Jev stub) provides bounded advice.
* **Application Code** authorizes outbound messages and saves an immutable SQLite decision record.

---

## Setup & Running

### Requirements
- Node.js v24+
- npm v11+

### Installation
```bash
git clone <repo-url>
cd PG-Tech-Assignment
npm install
```

### Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default runs completely offline using `INTERPRETER_MODE=mock`. To enable live Claude Sonnet 5 calls:
```env
ORDER_DESK_API_KEY=your_key_here
ANTHROPIC_MODEL=claude-sonnet-5
INTERPRETER_MODE=anthropic
```

### Run Tests
```bash
npm test
```

### Run Automated Evaluation Suite
```bash
# Run with Deterministic Advisor
npm run eval

# Run with Jev Advisor Stub
npm run eval:jev
```

### Start API Server
```bash
npm start
```
Server listens on `http://localhost:3000`.

---

## Example API Requests

### 1. Inbound Order Process (`POST /v1/orders/process`)
```bash
curl -X POST http://localhost:3000/v1/orders/process \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "msg-001",
    "source": "zalo",
    "sender": "0901234567",
    "content": "Cho em 5 thùng ly 500ml trong suốt nha"
  }'
```
Response:
```json
{
  "decisionId": "dec_run_abc123",
  "action": "QUOTE",
  "reason": "ORDER_READY",
  "runId": "run_abc123"
}
```

### 2. Retrieve Audit Record (`GET /v1/decisions/:runId`)
```bash
curl http://localhost:3000/v1/decisions/run_abc123
```

---

## Deterministic Failure Injection
Simulate outages by setting environment variables or passing runtime overrides:
- `FAIL_CUSTOMER_LOOKUP=none|error|timeout|malformed`
- `FAIL_PRODUCT_LOOKUP=none|error|timeout|malformed`
- `FAIL_STOCK_LOOKUP=none|error|timeout|malformed`
- `FAIL_PRICING_LOOKUP=none|error|timeout|malformed`
- `FAIL_MESSAGING=none|error|timeout`

All failures fail closed safely (`ESCALATE` with typed reason).
