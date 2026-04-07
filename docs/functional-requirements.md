# Arch IDE — Functional Requirements

## Product Vision

An enterprise-grade IDE built around Claude (or configurable LLM) where architectural diagrams are the primary interface. Code is generated and maintained by the AI. Developers are designers — not implementers.

---

## Target Users

- Full-stack developers working on enterprise codebases
- Tech leads coordinating architectural decisions across teams
- Architects designing systems without writing implementation
- **Primary deployment context:** Enterprise, multi-developer, shared codebase

---

## Core Principles

1. **Architecture is the source of truth** — not code, not documentation
2. **Claude is the primary code author** — developers design, Claude implements
3. **Diagrams are the shared language** — between developers, between developer and Claude
4. **Human in the loop at the right moments** — design decisions, pattern choices, pre-commit review
5. **Plan first, execute second** — solid architectural plan before any code changes

---

## Functional Requirements

### FR-0: Repo Ingestion & Preparation

**Triggered manually. Re-runnable as the repo evolves.**

- [ ] Static analysis pass — dependency graphs, module boundaries, call graphs
- [ ] Generate architectural diagrams from code structure
- [ ] Generate granular diagrams (class, state) from code parsing scripts
- [ ] Run "repo improvement" scripts to make codebase Claude-friendly:
  - Add contextual comments throughout codebase
  - Insert grep tags for code regions, patterns, and important areas
  - Auto-generate `CLAUDE.md` based on architectural findings
  - Detect and document existing coding standards and patterns
- [ ] Persist repo state so analysis is not repeated every session
- [ ] Surface detected patterns and standards for developer validation
- [ ] Developer can correct Claude's architectural hypothesis before it becomes source of truth
- [ ] **Future:** Auto-detect architectural drift and prompt re-run

---

### FR-1: Session Start — Change Surfacing

- [ ] On open, surface high-level changes since last session
- [ ] Show what areas of the architecture changed — not granular file diffs
- [ ] Indicate who made changes (multi-developer context)
- [ ] Flag architectural drift from established patterns
- [ ] Fast — this must be immediate, not a loading screen

---

### FR-2: Story Pickup & Working Area Identification

- [ ] Developer inputs a story/requirement — free-form natural language
- [ ] Ticket system integration — configurable source (Jira, Linear, or any)
- [ ] Claude identifies the relevant working area from the requirement
- [ ] Surface current architecture of that area as state/class diagrams
- [ ] Developer reviews and converses with Claude about planned changes
- [ ] Claude confirms understanding before proceeding

---

### FR-3: Design, Pattern Recognition & Proposal

- [ ] Claude works out implementation approach behind the scenes
- [ ] Proactively identifies refactor opportunities (e.g. Adapter, CQRS, Event-Driven)
- [ ] Present design pattern options **visually** — side-by-side diagram comparison
- [ ] Each option shows: pattern name, tradeoffs, architectural diagram preview
- [ ] Claude recommends an option but does not force it
- [ ] Developer can tweak proposed diagrams visually before execution
- [ ] Developer can inject constraints and thoughts conversationally
- [ ] Developer can annotate diagrams directly ("this boundary is wrong", "make this async")
- [ ] Claude finalises design based on developer input
- [ ] Developer project preferences persist — Claude learns team patterns over time
- [ ] Configurable presentation mode (visual comparison, conversational, structured card)

---

### FR-4: Execution & Architecture Maintenance

- [ ] Claude executes code changes based on approved design
- [ ] Diagrams update automatically as code changes are made
- [ ] Claude Hooks trigger diagram sync on architectural code changes
- [ ] Two-tier diagram system maintained:
  - **Granular diagrams** — auto-generated from code (classes, modules)
  - **Architectural models** — maintained from scripts and developer intent
- [ ] Developer can review generated code before commit (optional, configurable)
- [ ] Developer can adjust architecture post-execution if requirements change
- [ ] Full audit trail of decisions — what was proposed, what was chosen, why

---

### FR-5: Internal PR & Commit

- [ ] Developer reviews final architectural diagram before committing
- [ ] **Internal PR** — configurable, on by default
  - GitHub/Bitbucket-style UI
  - Click through source code, view line changes
  - Add comments on specific lines or components
  - Approve → creates external pull request
  - Needs Work → Claude reviews comments and iterates
- [ ] Claude responds to internal PR comments as a collaborator
- [ ] External PR raised after internal approval
- [ ] PR includes architectural diagram diff alongside code diff
- [ ] Audit log attached to PR — decisions made, patterns chosen, alternatives considered

---

## Non-Functional Requirements

### Scalability
- Support large monorepos (100k+ files)
- Support hundreds of concurrent developers on shared architectural models
- Diagram rendering must remain performant as complexity grows
- Incremental analysis — don't re-process the whole repo for small changes

### Configurability
- LLM provider is configurable — Claude, Codex, or any compatible model
- Ticket system integration is configurable — agnostic of source
- Friction levels configurable per team or per developer
- Pattern preferences configurable at project level
- Internal PR gate configurable (on/off, approval rules)
- Diagram presentation mode configurable

### Auditability
- Full history of architectural decisions
- Record of who approved what and when
- Record of pattern choices and alternatives considered
- Claude's reasoning surfaced and stored, not just its output
- Audit log exportable for compliance

### Security
- LLM provider covered by enterprise agreement (no additional data handling concerns)
- Code does not leave the enterprise's chosen LLM boundary
- No telemetry without explicit opt-in

---

## Key Differentiators

1. **Architecture as source of truth** — not a byproduct of code
2. **Internal PR before external** — human-in-the-loop gate before anything goes public
3. **Pattern advisor** — Claude surfaces design decisions visually, developer chooses
4. **Repo ingestion pipeline** — makes any existing codebase Claude-ready
5. **Claude as primary code author** — developers design systems, not write syntax
6. **Configurable LLM** — enterprise can use their existing model agreements
