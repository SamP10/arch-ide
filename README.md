# Arch IDE

> An IDE built around Claude where architecture is the primary interface. Code is tucked away — not hidden, but not the focus.

---

## Vision

Most IDEs put code at the center. Arch IDE puts **architecture** at the center.

Developers think in systems — services, data flows, boundaries, contracts. The code is the implementation detail. Claude holds that detail. You hold the design.

---

## Core Concept

### Three Layers

| Layer | What it is | Who owns it |
|---|---|---|
| **Architecture** | Interactive diagrams — C4, domain models, data flows | Developer |
| **Interface** | APIs, contracts, schemas between components | Developer + Claude |
| **Code** | Implementation — generated, maintained, version controlled | Claude |

The diagram is the source of truth. Not a byproduct. Not documentation. The actual source of truth.

---

## Key Features (Planned)

### Architecture-First Interface
- Interactive diagrams as the primary view
- Click a component to inspect or modify it
- Describe what you want — Claude updates the diagram and the code

### Claude Hooks for Sync
- Claude Hooks keep diagrams in sync when code changes underneath
- High-level architectural changes propagate automatically
- Bidirectional: diagram changes → code, code changes → diagram

### Two-Tier Diagram Generation
- **Granular diagrams** (classes, modules, dependencies) — auto-generated from code via scripts
- **Architectural models** (services, domains, boundaries) — built from intentional scripts, refined by the developer
- Granular = automatic. Architectural = deliberate.

### Native IDE (Not a Web App)
- Electron-based interactive IDE
- Proper developer experience — keyboard shortcuts, panels, file access
- Claude is the runtime, not a plugin

---

## The Brownfield Problem

Existing codebases are where this matters most — and where it's hardest.

**Proposed approach:**
1. Run a static analysis pass — dependency graphs, module boundaries, call graphs
2. Feed structured data (not raw code) to Claude
3. Claude generates an initial architectural diagram as a hypothesis
4. Developer validates and corrects the diagram
5. Corrected diagram becomes the source of truth — Claude maintains it from here

The key insight: don't ask Claude to understand a million lines of code at once. Build a coarse map first, drill in component by component. Developer corrections train the model of the system.

---

## MVP Path

### Phase 1 — Architecture Chat
- Claude + mermaid file as the "diagram"
- Describe a system in natural language
- Claude maintains a live diagram alongside generated code
- No custom UI — validate the workflow first

**Validates:** Does diagram-first actually feel better than code-first?

### Phase 2 — Interactive Diagram View
- Simple web/Electron UI rendering the diagram
- Click a component → Claude chat scoped to that component
- Changes in chat update the diagram

**Validates:** Is the diagram a better entry point than a file tree?

### Phase 3 — Bidirectional Sync
- Diagram edits propagate to code via Claude
- Code changes update the diagram
- Claude Hooks drive the sync

**Validates:** Can the diagram stay trusted over time?

---

## Stack (Proposed)

- **AI:** Claude API — `claude-opus-4-6`
- **Diagrams:** [Mermaid](https://mermaid.js.org/) or [D2](https://d2lang.com/)
- **Shell:** Electron (native IDE experience)
- **Code storage:** Local filesystem, standard git
- **Hooks:** Claude Code hooks for diagram sync triggers

---

## Open Questions

- [ ] How does the diagram handle ambiguity? Real systems are messy — diagrams lie by simplifying.
- [ ] What is the escape hatch when a developer needs to drop into code?
- [ ] How do we scope Claude's context in large brownfield repos without losing fidelity?
- [ ] What's the right diagram language — C4, Mermaid, D2, something custom?
- [ ] Multi-developer workflows — how do diagram conflicts get resolved?

---

## Project Structure (To Be Built)

```
arch-ide/
├── README.md
├── docs/
│   ├── architecture.md       # meta — the IDE's own architecture
│   └── research/             # diagram tools, Claude API patterns, prior art
├── scripts/
│   └── analyze.js            # static analysis → diagram generation
├── src/
│   ├── core/                 # Claude integration, hook handlers
│   ├── diagrams/             # diagram rendering, sync logic
│   └── shell/                # Electron app shell
└── examples/
    ├── greenfield/           # start-from-scratch demo
    └── brownfield/           # existing repo onboarding demo
```
