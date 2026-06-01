# Test Design Doc: Sample Feature Integration

> **Area**: testing
> **Status**: Draft
> **Author**: Test User
> **Last Updated**: 2026-05-12

This document exists to exercise the **Markdown PR Comments for GitHub** extension. It deliberately includes every markdown construct the extension's line-mapping has to handle — tables, mermaid diagrams, code blocks, nested lists, blockquotes, task lists, and so on.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
  - [Architecture Diagram](#architecture-diagram)
  - [Sequence Diagram](#sequence-diagram)
  - [Impact Analysis](#impact-analysis)
- [Implementation Phases](#implementation-phases)
  - [Phase 1: Foundation](#phase-1-foundation)
  - [Phase 2: Smart Routing](#phase-2-smart-routing)
  - [Phase 3: CLI and Docs](#phase-3-cli-and-docs)
- [Task List](#task-list)
- [Risks](#risks)
- [Code Samples](#code-samples)
- [References](#references)

---

## Overview

This is the **overview paragraph**. It contains _emphasis_, `inline code`, and a [link to docs](https://example.com/docs). The goal is to have several paragraphs in a row so the text-matcher has to handle ordering.

A second paragraph follows directly. Reviewers should be able to:

1. Comment on this entire paragraph from rich diff
2. Comment on individual list items
3. Reply to existing threads inline
4. Resolve / unresolve threads
5. Drag-select a range across multiple paragraphs

> A blockquote here, with **bold** and `code`. Multiple lines:
> Line two of the quote.
> Line three with a [link](https://example.com).

A short paragraph after the blockquote, used as a target for "comment on line right after a blockquote" tests.

---

## Architecture

### Architecture Diagram

```mermaid
graph TD
    User[User / CLI]
    App[Application]
    Svc[Service]
    DB[(Database)]

    User -->|request| App
    App -->|query| DB
    App -->|invoke| Svc
    Svc -->|"reads/writes (via SDK)"| DB
    Svc -->|response| App
    App -->|render| User

    style App fill:#FFD700,stroke:#333
    style Svc fill:#90EE90,stroke:#333
```

**Legend**: 🟢 New | 🟡 Modified

### Sequence Diagram

```mermaid
sequenceDiagram
    participant U as User
    participant A as App
    participant S as Service
    U->>A: submit request
    A->>S: forward
    S->>S: process
    S-->>A: result
    A-->>U: response
```

### Impact Analysis

| Component | Change Type | Description |
|-----------|-------------|-------------|
| `Application.start` | Modified | Initializes new service connection |
| `Service.handle` | New | Routes requests to backends based on type |
| `Service.validate` | New | Pre-flight checks before dispatch |
| `Database.schema` | Modified | Adds `requested_at`, `processed_at` columns |
| CLI (`app/__main__.py`) | Modified | Adds `--service-url`, `--strict` flags |
| `pyproject.toml` | Possibly modified | Bump min version of `sdk-lib` if needed |
| Tests | New | Unit + integration tests for new routing |

---

## Implementation Phases

### Phase 1: Foundation

**Goal**: Get the new service plumbing in place without changing observable behavior.

**Approach**: Add `Service` class with `accepts()` and `handle()` methods. Wire it into `Application.start` but only activate when an opt-in kwarg is set. Default path remains unchanged.

**Dependencies**: none.

#### Tasks

1. **Create the `Service` class**
   - File: `src/app/service.py`
   - Methods: `__init__`, `accepts(request) -> bool`, `handle(request) -> Response`
   - Acceptance criteria:
     - [ ] `Service` instance is constructible with default args
     - [ ] `accepts()` returns `True` for supported request types
     - [ ] `accepts()` returns `False` for unsupported types
     - [ ] `handle()` returns a valid `Response` for an accepted request

2. **Wire into the constructor**
   - File: `src/app/_application.py`
   - Add `service_url: str | None = None` kwarg
   - When set, instantiate `Service` and register it at position 0
   - Acceptance criteria:
     - [ ] `Application(service_url="...")` activates the service
     - [ ] `Application()` (no kwargs) preserves existing behavior

#### Tests

- [ ] Unit: `accepts()` for all supported types
- [ ] Unit: `handle()` mock returns a valid response
- [ ] Integration: end-to-end call via `Application(service_url=...)`

---

### Phase 2: Smart Routing

**Goal**: Route requests to the right backend based on type.

**Approach**: Add a routing table and a `_resolve_backend()` helper.

**Dependencies**: Phase 1 complete.

#### Tasks

1. **Routing table**
   - File: `src/app/service.py`
   - Add `_BACKEND_MAP: dict[str, str]` constant
   - Add `_resolve_backend(request)` returning `(backend_name, modality)`
   - Acceptance criteria:
     - [ ] Maps each supported type to its backend
     - [ ] Returns a default backend for unknown types
     - [ ] Logs a warning on fallback

2. **Wire into `handle()`**
   - Acceptance criteria:
     - [ ] `handle()` consults the routing table for every request
     - [ ] Backend choice is observable via `Response.metadata['backend']`

#### Tests

- [ ] Unit: each supported type routes to the expected backend
- [ ] Unit: unknown type → fallback + warning logged

---

### Phase 3: CLI and Docs

**Goal**: Surface the new options on the CLI; update the README.

**Approach**: Add argparse flags; document examples.

**Dependencies**: Phases 1 and 2.

#### Tasks

1. **CLI flags**
   - File: `src/app/__main__.py`
   - Add `--service-url` (str) and `--strict` (store_true)
   - Acceptance criteria:
     - [ ] `app run --service-url "..."` activates the service
     - [ ] `app run --strict` rejects unknown types

2. **README**
   - Add a "Service Integration" section after the existing "Quick Start"
   - Acceptance criteria:
     - [ ] Example shows `--service-url` usage
     - [ ] Output sample matches what the service returns

---

## Task List

```yaml
tasks:
  - id: "1.1"
    phase: 1
    title: "Create Service class"
    files:
      - path: "src/app/service.py"
        action: "create"
    dependencies: []
    acceptance_criteria:
      - "Service is constructible"
      - "accepts() returns True for supported types"

  - id: "1.2"
    phase: 1
    title: "Wire into Application"
    files:
      - path: "src/app/_application.py"
        action: "modify"
    dependencies: ["1.1"]
    acceptance_criteria:
      - "Application(service_url=...) activates the service"
      - "Default constructor preserves existing behavior"

  - id: "2.1"
    phase: 2
    title: "Add routing table"
    files:
      - path: "src/app/service.py"
        action: "modify"
    dependencies: ["1.2"]
    acceptance_criteria:
      - "Maps supported types to backends"
      - "Returns a fallback for unknown types"

  - id: "3.1"
    phase: 3
    title: "Add CLI flags"
    files:
      - path: "src/app/__main__.py"
        action: "modify"
    dependencies: ["2.1"]
    acceptance_criteria:
      - "--service-url accepted"
      - "--strict rejects unknown types"
```

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Service URL changes upstream | Medium | Medium | Pin version; capture URL in config |
| Routing table drift | Low | High | Cover with unit tests per supported type |
| Backward compatibility regressions | Low | High | Default kwargs unchanged; add regression tests |
| CLI flag naming conflict | Low | Low | Prefix with `--service-` |
| Network flakiness in integration tests | Medium | Low | Mark slow tests `@pytest.mark.slow`; skip by default |

---

## Code Samples

### Python: minimal usage

```python
from app import Application

app = Application(service_url="https://example.com/svc")
result = app.handle({"type": "ping", "payload": "hello"})
print(result.body)
# → "pong"
```

### Python: with strict mode

```python
from app import Application, UnknownRequestType

app = Application(service_url="https://example.com/svc", strict=True)

try:
    app.handle({"type": "unknown", "payload": ""})
except UnknownRequestType as e:
    print(f"rejected: {e}")
```

### Shell

```bash
# Activate the service
app run --service-url "https://example.com/svc" sample.json

# Strict mode rejects unknown types
app run --service-url "https://example.com/svc" --strict sample.json
```

### Inline language fragments

A snippet of `JavaScript` mixed into prose: `const x = arr.map((n) => n * 2);`. A snippet of SQL: `SELECT id, name FROM users WHERE active = 1 ORDER BY name;`. Both should remain commentable without breaking the surrounding paragraph.

---

## Nested Lists

A taste of nested-list line mapping:

- Top-level item one
  - Nested item A
  - Nested item B
    - Deeply nested item
- Top-level item two
  - Nested item C
- Top-level item three

Numbered:

1. First
   1. Sub-first
   2. Sub-second
2. Second
3. Third

Task list:

- [x] Initial design reviewed
- [x] Phase 1 implemented
- [ ] Phase 2 tests added
- [ ] CLI documented
- [ ] Release notes drafted

---

## HTML / Edge Cases

Some markdown documents embed raw HTML for collapsible sections:

<details>
<summary>Click to expand sample output</summary>

```
status: ok
backend: primary
latency_ms: 42
```

</details>

A paragraph after the `<details>` block — used as a target for "comment after raw HTML" tests.

A horizontal rule:

---

A paragraph after the horizontal rule.

---

## References

- [GitHub PR Review API](https://docs.github.com/en/rest/pulls/comments)
- [Mermaid syntax](https://mermaid.js.org/intro/)
- Internal design wiki: [link](https://example.com/wiki/design)

## Change Log

| Date | Author | Change Summary |
|------|--------|----------------|
| 2026-05-12 | Test User | Initial test document for the rich-diff comments extension |
