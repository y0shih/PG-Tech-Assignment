# Delta Packaging Supply Order Desk Agent — Submission Report

## 1. Design Decisions
We structured the solution around the core invariant: **"LLM interprets. Tools provide facts. Code enforces policy. Code owns actions."**
Rather than building an unconstrained autonomous agent, we implemented a linear 7-stage pipeline (Idempotency -> Interpretation -> Fact Resolution -> Deterministic Policy -> Bounded Advisor -> Action Execution -> Audit Logger). SQLite provides idempotency tracking and audit records.

## 2. Agent vs Deterministic Responsibilities
- **LLM Responsibility**: Limited strictly to entity extraction (`customerReference`, `productReference`, `quantity`, `language`) from messy Vietnamese/English. Untrusted text is enclosed in `<inbound_message>` XML boundaries. The LLM has zero authority to quote prices, issue discounts, or dispatch messages.
- **Deterministic Responsibility**: Hard business rules (credit hold enforcement, product ambiguity resolution, duplicate suppression, stock checks, pricing lookups, and outbound messaging authorization) are executed exclusively in typed TypeScript.

## 3. Failure Handling
External systems and repositories are wrapped in a typed reliability decorator (`withReliability`) providing:
- 2000ms timeout bounds.
- Bounded exponential backoff (2 retries).
- Runtime schema validation using Zod.
- Fail-closed behavior: Any tool timeout or malformed response trips the policy engine to immediately `ESCALATE` with typed reasons (`TOOL_TIMEOUT`, `MALFORMED_TOOL_RESPONSE`).
- Deterministic failure injection via environment variables (`FAIL_PRICING_LOOKUP=timeout`) allows predictable verification during live reviews.

## 4. Evaluation Results
The test suite includes 18 automated end-to-end scenarios covering normal orders, ambiguous products, credit holds, duplicates, prompt injections, low inventory, and system failures:
- Deterministic Advisor: 18 / 18 passed (100% pass rate).
- Jev Advisor: 18 / 18 passed (100% pass rate).
Both advisor configurations verify that bounded recommendation systems cannot bypass hard credit holds, duplicate detection, or tool failures.

## 5. Cost and Latency
- Prompts use compact system instructions (< 250 tokens).
- Extraction schema requires < 60 completion tokens.
- Mock mode achieves < 5ms latency at $0.00 cost.
- Claude Sonnet 5 calls average ~650ms latency with an estimated cost of ~$0.0015 per message, well below the $20 project ceiling (sufficient for > 10,000 runs). The test runner enforces an automated cutoff if cumulative spend nears $20.

## 6. n8n Migration
In production, n8n should serve strictly as the integration and transport orchestrator, not the policy engine:
1. Inbound webhook from Zalo / Email triggers n8n workflow.
2. n8n normalizes transport metadata and forwards to `POST /v1/orders/process`.
3. The core TypeScript engine executes the 7-stage pipeline, enforcing business policy centrally.
4. n8n receives the structured decision (`QUOTE`, `ASK`, `ESCALATE`, `DO_NOTHING`) and handles multi-channel delivery (Zalo API, SMTP, or CRM notification).
This avoids duplicating complex business rules across dozens of visual workflow nodes.

## 7. AI Tools Used
Claude Sonnet was utilized during design brainstorming, structuring test case permutations, and authoring Vietnamese mock phrases. All architectural boundaries, schemas, and policy precedence rules were validated and verified.

## 8. Known Gaps
- Multi-line item orders: Currently optimized for single-product orders. Expanding to compound baskets requires list-based extraction in `OrderIntent`.
- Unit conversions: Supports standard packaging units (`thùng`, `kg`, `hộp`); complex fractional unit math requires dedicated conversion tables.

## 9. Inbound Text Ingestion & Catalog Search Flow
When unstructured text is submitted via the test input or inbound webhook:
1. **Idempotency & Fingerprinting**: A normalized SHA-256 hash (`source|sender|normalized_content`) traps duplicate submissions in SQLite before triggering LLM or search layers.
2. **Untrusted Text Isolation**: Inbound text is wrapped in `<inbound_message>` XML tags, neutralizing prompt injection attempts (e.g. discount bypass commands) and forcing strict entity extraction into `OrderIntent`.
3. **Hierarchical Catalog Search**:
   - **Exact Matching**: Searches product repository against exact SKU or product title.
   - **Multi-Token Intersect Search**: If no exact match, tokenizes search string and matches items containing all tokens (e.g., `"ly 500ml trong suốt"` resolves to `LY-500-TS`).
   - **Ambiguity Detection**: If multiple catalog items match (e.g., query `"ly 500ml"` matches both clear and lidded varieties), the engine flags `PRODUCT_AMBIGUOUS` and asks the customer to clarify instead of guessing.
   - **Catalog Absence**: If zero items match, flags `PRODUCT_NOT_FOUND` to prompt the customer for catalog-supported items.
4. **Customer Resolution Fallback**: Matches sender ID (phone/email) first; if sender is new, falls back to customer name reference extracted by the LLM from the text.
5. **Interactive UI Audit**: The dashboard renders a full audit trace for every text submission, showing the raw input, extracted entities, matched warehouse SKUs, stock availability, policy checks, and outbound quotes.

