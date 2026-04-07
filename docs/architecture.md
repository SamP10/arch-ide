# Arch IDE — Architectural Plan

## Decision: Build from Scratch

**Rationale:** The core UX is categorically different from a code editor. Forking VS Code would mean fighting its code-first assumptions. Familiarity is medium priority — users are malleable given the AI shift currently underway. Full design freedom is worth the adoption investment.

**Shell:** Electron — native IDE experience, proper keyboard shortcuts, panels, file access, cross-platform.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Arch IDE (Electron)                   │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Diagram    │  │    Claude    │  │   Internal    │  │
│  │  Studio     │  │    Chat      │  │   PR Review   │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                │                   │          │
│  ┌──────▼────────────────▼───────────────────▼───────┐  │
│  │                  Core Orchestrator                 │  │
│  │     (State Management, Event Bus, Sync Engine)    │  │
│  └──────┬────────────────┬───────────────────┬───────┘  │
│         │                │                   │          │
│  ┌──────▼──────┐  ┌──────▼───────┐  ┌────────▼──────┐  │
│  │   Diagram   │  │     LLM      │  │     Repo      │  │
│  │   Engine    │  │   Adapter    │  │    Manager    │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────┘
         │                │                   │
   ┌─────▼─────┐   ┌──────▼──────┐   ┌───────▼──────┐
   │  Mermaid  │   │ Claude API  │   │ Local Repo   │
   │  / D2     │   │ / Codex /   │   │ + Git        │
   │           │   │ Configrable │   │              │
   └───────────┘   └─────────────┘   └──────────────┘
```

---

## Core Components

### 1. Diagram Studio (Primary UI)
The main view. Not a file tree — an interactive architectural diagram.

**Responsibilities:**
- Render architectural and granular diagrams
- Handle developer annotations and visual edits
- Surface pattern comparison views (side-by-side)
- Show change highlights since last session
- Preview proposed architectural changes before execution
- Maintain diagram state in sync with code

**Key interactions:**
- Click component → scoped Claude chat opens
- Annotate component → constraint passed to Claude
- Drag/reshape → triggers Claude to validate and plan changes
- Approve proposed diagram → triggers execution

---

### 2. Claude Chat Panel
Persistent conversation interface, always scoped to the current working area.

**Responsibilities:**
- Receive natural language input from developer
- Display Claude reasoning and proposals
- Handle story/requirement input
- Surface pattern recommendations with diagram previews
- Manage conversation history per session and per component

---

### 3. Internal PR Review
GitHub/Bitbucket-style review UI, triggered before external PR.

**Responsibilities:**
- Display code diff alongside diagram diff
- Allow line-level comments
- Approve → triggers external PR creation
- Needs Work → passes comments back to Claude for iteration
- Full audit log of review cycle

---

### 4. Core Orchestrator
The central nervous system. Manages state and coordinates all components.

**Responsibilities:**
- Event bus — diagram changes, code changes, Claude responses
- State management — current working area, session state, repo state
- Sync engine — bidirectional diagram ↔ code sync
- Claude Hooks integration — triggers diagram updates on code changes
- Audit trail — records all decisions, proposals, approvals

---

### 5. Diagram Engine
Handles diagram generation, rendering, and maintenance.

**Responsibilities:**
- Two-tier diagram system:
  - **Granular** — auto-generated from code via static analysis scripts
  - **Architectural** — maintained from scripts and developer intent
- Diagram diff calculation (for change surfacing and PR review)
- Diagram format: Mermaid or D2 (configurable)
- Export diagrams for PR attachment

---

### 6. LLM Adapter
Abstraction layer over any LLM provider. Configurable per enterprise.

**Responsibilities:**
- Uniform interface regardless of provider (Claude, Codex, etc.)
- Prompt construction and context management
- Streaming responses to UI
- Context window management for large repos
- Session and project memory persistence

**Supported providers (initial):**
- Anthropic Claude (claude-opus-4-6)
- OpenAI Codex
- Any OpenAI-compatible API

---

### 7. Repo Manager
Manages the local repository, git operations, and repo state persistence.

**Responsibilities:**
- Repo ingestion pipeline (Step 0)
- Static analysis — dependency graphs, module boundaries, call graphs
- Repo improvement scripts — comments, grep tags, CLAUDE.md generation
- Persist repo state between sessions
- Detect changes since last session (for Step 1 surfacing)
- Git operations — commit, branch, PR creation
- Architectural drift detection

---

## Data Flow: Developer Picks Up a Story

```
Developer inputs story
        │
        ▼
LLM Adapter → Claude identifies working area
        │
        ▼
Repo Manager → fetch current state of that area
        │
        ▼
Diagram Engine → generate state/class diagrams for area
        │
        ▼
Diagram Studio → display to developer
        │
Developer converses with Claude
        │
        ▼
Claude identifies pattern opportunity (e.g. Adapter)
        │
        ▼
Diagram Engine → generate side-by-side pattern comparison
        │
        ▼
Diagram Studio → developer reviews, annotates, tweaks
        │
Developer approves design
        │
        ▼
Core Orchestrator → execution plan locked
        │
        ▼
LLM Adapter → Claude executes code changes
        │
        ▼
Claude Hooks → trigger diagram sync
        │
        ▼
Diagram Engine → update architectural diagrams
        │
        ▼
Internal PR Review → developer reviews, comments
        │
    ┌───┴───┐
Approve   Needs Work
    │         │
    ▼         ▼
External   Claude
  PR       iterates
```

---

## Repo Ingestion Pipeline (Step 0)

```
Raw Repo
    │
    ▼
Static Analysis Scripts
  - Dependency graph
  - Module boundaries
  - Call graphs
  - Pattern detection
    │
    ▼
LLM Adapter → Claude generates architectural hypothesis
    │
    ▼
Diagram Engine → render hypothesis as diagrams
    │
    ▼
Developer validates / corrects
    │
    ▼
Repo Improvement Scripts run:
  - Add contextual comments
  - Insert grep tags (regions, patterns, important areas)
  - Generate CLAUDE.md from findings
  - Document detected standards
    │
    ▼
Repo State persisted → IDE ready for daily use
```

---

## Diagram Sync Strategy (Claude Hooks)

Bidirectional sync is the hardest technical problem. Strategy:

1. **Diagram → Code:** Developer approves diagram change → Orchestrator locks execution plan → Claude executes → Hooks confirm completion
2. **Code → Diagram:** Claude Hooks fire on file changes → Diff analyzed → Diagram Engine updates affected components only (not full re-render)
3. **Conflict resolution:** If diagram and code diverge (e.g. manual code edit), surface as architectural drift at next session start

---

## Persistence & State

| What | Where | When updated |
|---|---|---|
| Repo state | Local `.arch-ide/` directory | After ingestion, after each session |
| Architectural diagrams | `.arch-ide/diagrams/` | After each approved change |
| Session history | `.arch-ide/sessions/` | Continuous |
| Audit log | `.arch-ide/audit/` | Every decision, proposal, approval |
| Project preferences | `.arch-ide/config.json` | When developer sets patterns/standards |
| CLAUDE.md | Repo root | After ingestion, after major changes |

---

## Configuration

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-opus-4-6",
    "apiEndpoint": "configurable for enterprise"
  },
  "ticketSystem": {
    "provider": "jira",
    "projectKey": "configurable"
  },
  "diagrams": {
    "format": "mermaid",
    "presentationMode": "visual-comparison"
  },
  "internalPR": {
    "enabled": true,
    "requireApproval": true
  },
  "friction": {
    "level": "medium",
    "patternReview": true,
    "codeReviewBeforeCommit": false
  },
  "repoIngestion": {
    "autoDetectDrift": false,
    "improvementScripts": true
  }
}
```

---

## Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| Shell | Electron | Native IDE experience, cross-platform |
| UI Framework | React | Component model fits panel-based IDE layout |
| Diagram Rendering | Mermaid + D2 | Mermaid for granular, D2 for architectural (configurable) |
| State Management | Zustand or Redux | Predictable state for complex orchestration |
| LLM Integration | Anthropic SDK + OpenAI SDK | Adapter pattern over both |
| Static Analysis | Tree-sitter | Language-agnostic AST parsing for repo ingestion |
| Git Operations | isomorphic-git | Pure JS git — no shell dependency |
| Persistence | SQLite (via better-sqlite3) | Local, fast, queryable audit log |
| Hooks | Claude Code Hooks | Diagram sync triggers |

---

## Open Questions

- [ ] How do we handle diagram complexity at scale? (100+ component architectures)
- [ ] Multi-developer conflict resolution on shared architectural models
- [ ] How granular is "architectural drift" detection — what threshold triggers a warning?
- [ ] Offline mode — can the IDE function without LLM for diagram viewing/navigation?
- [ ] How do we version architectural diagrams alongside code in git?
