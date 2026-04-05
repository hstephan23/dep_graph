# DepGraph

DepGraph is a lightweight tool for exploring source file dependencies as an interactive graph. It scans source trees or uploaded archives, builds a dependency graph, highlights circular dependencies, and provides deep analysis tools — in a browser UI, from the command line, or directly inside VS Code.

## Supported Languages

- **C / C++** — `#include` directives (`.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`)
- **JavaScript / TypeScript** — `import` and `require()` (`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`)
- **Python** — `import` and `from ... import`, including relative imports (`.py`)
- **Java** — `import` and `import static`, including wildcard expansion (`.java`)
- **Go** — `import` declarations with `go.mod` resolution (`.go`)
- **Rust** — `use`, `mod`, and `extern crate` (`.rs`)
- **C#** — `using` directives with namespace-to-file resolution (`.cs`)
- **Swift** — `import` declarations with local module resolution (`.swift`)
- **Ruby** — `require`, `require_relative`, and `load` (`.rb`)
- **Kotlin** — `import` declarations with package resolution (`.kt`, `.kts`)
- **Scala** — `import` declarations including grouped imports (`.scala`, `.sc`)
- **PHP** — `use`, `require`, `include`, and `require_once`/`include_once` with PSR-4 namespace resolution (`.php`)
- **Dart** — `import` declarations for package and relative imports (`.dart`)
- **Elixir** — `alias`, `import`, `require`, and `use` (`.ex`, `.exs`)

Language detection is automatic — DepGraph scans the target directory and enables the relevant parsers based on which file types are present.

## Features

### Visualization

- Interactive node-edge graph powered by Cytoscape.js with three layout algorithms: force-directed (COSE), hierarchical (dagre), and concentric
- **Transitive reduction** — redundant edges are automatically pruned (if A→B→C exists, the direct A→C edge is removed) to declutter the graph without losing structural information
- **Weighted edges** — edge thickness, color, and opacity scale with target importance (blend of in-degree and reach percentage), so critical dependency paths stand out visually
- **Adaptive layout** — the force-directed layout adjusts repulsion, gravity, and edge length based on graph density, keeping dense graphs readable and sparse graphs cohesive
- **Logarithmic node sizing** — node diameter uses a square-root scale (60–200px) based on inbound references, preventing high-degree hubs from dominating the view
- Treemap view for a heat-map style overview sized by file count and colored by a chosen metric (inbound, outbound, depth, impact, instability)
- Matrix view showing an N×N dependency grid with directory boundary markers
- Directory collapsing — toggle between a directory-level overview and the full file-level graph, with click-to-expand/collapse on any folder
- **Tree view** — a spacious hierarchical view showing downstream or upstream dependencies for any file, with risk indicators and file-type badges
- Focus lens — a fisheye distortion that magnifies nodes near the cursor while shrinking distant ones (toggle with `L`)
- Minimap for orientation in large graphs with click-to-pan
- Inline source preview with syntax highlighting (double-click any node)
- Smooth loading transitions with spinner overlay when switching layouts or views

### Analysis Tools

- **Cycle detection** — Tarjan's SCC algorithm highlights circular dependencies with red edges and a warning banner
- **Blast radius** — select a file to see its direct and transitive dependents, with impact percentage and depth-stratified drill-down
- **Path finder** — find the shortest dependency path between any two files
- **Refactor simulator** — model file or dependency removals and preview what breaks, or use merge/split simulation to model combining two files into one or splitting a large file into parts, with full impact analysis
- **Story mode** — a generated multi-step walkthrough of the dependency structure covering hotspots, coupling, cycles, and metrics
- **Unused file detection** — identifies files with zero inbound references
- **Project insights** — a health dashboard scoring the graph on cycles, god files, coupling, fan-out, hub files, deep chains, and unstable core files, with export to JSON or Markdown
- **Depth warnings** — automatic banner when files exceed configurable depth or impact thresholds
- **Directory coupling** — measures inter-directory edge density and highlights tightly coupled pairs

### Query Terminal

A mini query language for filtering nodes by metrics. Open with `Q` or the Query button.

Examples: `files where inbound > 3 and outbound > 2`, `files in cycles`, `files where stability > 0.7`, `files matching utils/`. Supports highlight mode (show matches in yellow) and isolate mode (show only matches).

### Architectural Rules

- **Layer checking** — define an ordered list of architectural layers (e.g. `ui → service → data → util`) and flag any dependency that flows in the wrong direction
- **Dependency rules** — define forbidden or required dependency patterns using substring matching against file paths

### Filters & Controls

The toolbar is split into two rows. The top row holds the brand, action buttons (Insights, Query, Upload, Export, Theme, Tour, Help, Sidebar toggle), and status indicators. The second row holds the graph controls:

- **Filters** dropdown — filter by subdirectory, toggle system/external imports and isolated nodes, select language mode (language filter works with local directories, uploads, and GitHub clones — switching languages re-scans instantly without re-uploading)
- **Layout** pills — Force, Hierarchy, Concentric, plus a focus lens toggle
- **Scope** pills — toggle between Directories and All Files (when in directory view)
- **View** pills — Graph, Treemap, Matrix, with a metric selector for treemap
- **Search** input — find and center the graph on a file

Additional navigation: Quick Jump (`Cmd+K` / `Ctrl+K`) for instant file search, graph diff view to compare snapshots, and click-to-center from any sidebar list.

### Export

Export the current graph as JSON, PNG, Graphviz DOT, or Mermaid from the toolbar or with keyboard shortcuts (`e j`, `e p`, `e d`, `e m`).

### Keyboard Shortcuts

Press `?` in the UI to see all shortcuts. Highlights include: `1`/`2`/`3` for layouts, `Shift+1` through `Shift+0` for sidebar panels, `q` for query terminal, `f` to fit the graph, `m` for minimap, `t` for theme toggle, `s` for sidebar.

## Project Layout

```
DepGraph/
├── app.py              — Flask server, API routes, upload handling, security
├── graph.py            — core graph engine (build_graph, detect_languages, find_sccs)
├── parsers.py          — language-specific import resolution for all 14 languages
├── cli.py              — CLI entry point (depgraph command)
├── pyproject.toml      — package config (pip install .)
├── requirements.txt    — Flask, Gunicorn, Werkzeug
├── render.yaml         — Render deployment config
├── action.yml          — GitHub Action definition
├── static/
│   ├── index.html      — single-page frontend
│   ├── app.js          — core frontend logic and UI wiring
│   ├── graph-core.js   — Cytoscape instance, layouts, and node/edge styling
│   ├── simulation.js   — refactor simulator (removal, merge, split)
│   ├── analysis.js     — dependency rules and depth warnings
│   ├── story.js        — story mode walkthrough
│   ├── tools.js        — path finder, blast radius, query tools
│   ├── views.js        — treemap, matrix, and graph view switching
│   ├── ui.js           — sidebar panels, refs, unused files, directory collapsing
│   ├── query.js        — mini query language parser and execution
│   ├── exports.js      — JSON, PNG, DOT, Mermaid export
│   ├── timeline.js     — diff/timeline view for snapshot comparison
│   ├── state.js        — shared global state and helpers
│   ├── tour.js         — guided tour system
│   ├── style.css       — UI styles with light/dark theme
│   └── __tests__/      — frontend unit tests (Node.js built-in test runner)
│       ├── helpers.js     — test infrastructure (vm loader, DOM shim setup, factories)
│       ├── jsdom-shim.js  — minimal DOM shim (no npm dependencies)
│       ├── query.test.js  — query parser and filter tests
│       ├── analysis.test.js — depth warnings and insights tests
│       └── exports.test.js  — DOT, Mermaid, and Markdown export tests
├── vscode-extension/
│   ├── package.json    — extension manifest (commands, views, settings)
│   └── src/
│       ├── extension.ts  — activation, command registration, file watchers
│       ├── engine.ts     — spawns DepGraph CLI, caches graph data
│       ├── sidebar.ts    — tree views (dependencies, cycles, metrics)
│       ├── commands.ts   — command implementations (graph, cycles, blast radius, export)
│       ├── webview.ts    — interactive Cytoscape.js graph in a VS Code panel
│       ├── hover.ts      — mini dependency graph on import hover
│       ├── codeLens.ts   — inline dependency counts and metrics above files
│       ├── diagnostics.ts — cycle, depth, and high-impact warnings in Problems panel
│       └── config.ts     — reads workspace settings
├── tests/              — sample source trees for each supported language
└── examples/           — example outputs (Mermaid diagram)
```

The backend is split into three modules: `app.py` handles Flask routing and security, `graph.py` handles graph construction and cycle detection, and `parsers.py` handles language-specific import resolution. The CLI imports `graph.py` directly without requiring Flask.

## Installation

```bash
pip install .
```

This installs the `depgraph` command globally. Flask is included as a dependency for the web UI.

## CLI

```bash
depgraph ./my-project                        # print dependency tree in terminal
depgraph ./src --lang rust                   # force a specific language
depgraph ./src --hide-external               # hide system/stdlib imports
depgraph ./src --hide-isolated               # hide files with no dependencies
depgraph ./src --filter-dir utils            # only show files under a subdirectory
depgraph ./src --json                        # output JSON to stdout
depgraph ./src --json -o deps.json           # write JSON to file
depgraph ./src --dot                         # output Graphviz DOT
depgraph ./src --dot | dot -Tpng -o graph.png  # pipe to Graphviz for PNG
depgraph ./src --mermaid                     # output Mermaid diagram
depgraph ./src --serve                       # launch web UI and open browser
depgraph ./src --serve --port 3000           # web UI on a custom port
depgraph ./src --diff ./main-branch/src      # compare deps and output Markdown diff
depgraph ./src --diff ./base -o diff.md      # write diff to file
```

The terminal tree output includes colored badges for cycles and depth warnings, a coupling summary, and node/edge counts. Run `depgraph --help` for the full list of options.

## GitHub Action

DepGraph includes a GitHub Actions workflow that automatically comments a dependency diff on pull requests. When a PR changes import/include relationships, the workflow posts a summary of added/removed files, dependencies, and any new circular dependencies.

### Setup

Add this workflow to your repository at `.github/workflows/depgraph.yml`:

```yaml
name: Dependency Diff

on:
  pull_request:
    branches: [master]

permissions:
  pull-requests: write

jobs:
  depgraph:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install DepGraph
        run: pip install .

      - name: Checkout base branch
        run: |
          git fetch origin ${{ github.event.pull_request.base.ref }} --depth=1
          git worktree add /tmp/depgraph-base FETCH_HEAD

      - name: Run dependency diff
        id: diff
        run: |
          depgraph . --diff /tmp/depgraph-base --hide-external --hide-isolated -o /tmp/depgraph-diff.md
          if grep -q "No dependency changes detected" /tmp/depgraph-diff.md; then
            echo "has_changes=false" >> "$GITHUB_OUTPUT"
          else
            echo "has_changes=true" >> "$GITHUB_OUTPUT"
          fi

      - name: Comment on PR
        if: steps.diff.outputs.has_changes == 'true'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          PR_NUMBER=${{ github.event.pull_request.number }}
          COMMENT_ID=$(gh api repos/${{ github.repository }}/issues/${PR_NUMBER}/comments \
            --jq '.[] | select(.body | startswith("## DepGraph")) | .id' 2>/dev/null | head -1)
          if [ -n "$COMMENT_ID" ]; then
            gh api repos/${{ github.repository }}/issues/comments/${COMMENT_ID} -X DELETE 2>/dev/null || true
          fi
          gh pr comment "$PR_NUMBER" --body-file /tmp/depgraph-diff.md

      - name: Cleanup
        if: always()
        run: git worktree remove /tmp/depgraph-base --force 2>/dev/null || true
```

Change `branches: [master]` to match your default branch name. The workflow checks out the base branch into a temporary worktree, runs `depgraph --diff` to compare dependencies, and posts a collapsible Markdown comment on the PR. If there are no dependency changes, it stays silent. Previous DepGraph comments are replaced on each push to keep the PR clean.

## VS Code Extension

DepGraph includes a VS Code extension that brings dependency analysis directly into the editor. It uses the DepGraph CLI under the hood, so `pip install .` is a prerequisite.

### Commands

Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and search for "DepGraph":

- **Show Dependency Graph** — opens an interactive Cytoscape.js graph in a webview panel with force, hierarchy, and concentric layouts, search, and right-click context menu
- **Find Dependency Cycles** — lists detected cycles in a quick-pick menu
- **Show Dependents / Dependencies** — quick-pick lists of files that import or are imported by the current file
- **Blast Radius** — highlights all transitive dependents of the current file
- **Export as JSON / DOT / Mermaid** — writes graph data to file

### Sidebar Views

Three tree views appear in the Explorer sidebar under a DepGraph section:

- **Dependencies** — files sorted by depth, expandable to show imports and imported-by lists
- **Cycles** — detected circular dependencies with member files
- **File Metrics** — files sorted by impact with per-file depth, stability, and reach percentage

### Import Hover Preview

Hover over any import statement to see a mini dependency graph for the imported file — its metrics (depth, impact, stability, blast radius), who imports it, and what it imports, with second-level dependencies shown inline. Cycle membership is flagged with a warning. Works across all 14 supported languages.

### CodeLens & Diagnostics

Inline CodeLens annotations show inbound/outbound counts, depth, impact, and stability above each file. The extension also reports cycle membership, excessive depth, and high-impact files as warnings in the Problems panel.

### Settings

Configure under `depgraph.*` in VS Code settings:

- `pythonPath` — path to the Python interpreter (default: `python3`)
- `language` — force a language mode or use `auto` detection (default: `auto`)
- `hideExternal` — hide system/external imports (default: `true`)
- `hideIsolated` — hide files with no dependencies (default: `false`)
- `maxDepthWarning` — depth threshold for diagnostic warnings (default: `8`)
- `autoRefresh` — automatically refresh the graph when files change (default: `true`)

The extension activates automatically when the workspace contains supported source files.

## Web UI

Start the web server directly:

```bash
python app.py
```

The server runs on [http://localhost:8080](http://localhost:8080). Set `PORT` to change the port, and `FLASK_DEBUG=true` to enable dev mode (shows the directory input bar).

### Scan a local directory

Enter a directory path in the dev-mode input bar and click Generate. DepGraph auto-detects which languages are present and enables the appropriate parsers.

### Upload source files

Click Upload in the toolbar to upload a `.zip` archive or any supported source file. ZIP uploads are extracted into a temporary directory before parsing.

### Sidebar Panels

The sidebar has ten panels organized in three groups:

**Inspect:** Refs (reference counts and cycle list), Analysis (directory coupling and per-node metrics like depth, impact, stability), Unused (zero-inbound files), Blast Radius (transitive impact of a selected file).

**Tools:** Layers (architectural layer violations), Rules (custom forbidden/required dependency patterns), Path Finder (shortest path between two files), Diff (compare two graph snapshots), Simulate (model file removals and preview impact, plus merge/split what-if analysis).

**More:** Story Mode (generated walkthrough of the dependency structure).

## API

All graph endpoints return JSON with `nodes`, `edges`, `has_cycles`, `cycles`, `unused_files`, `coupling`, and `depth_warnings`.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/graph` | GET | Build graph from a local directory or re-filter an upload/clone via `upload_token` |
| `/api/upload` | POST | Build graph from an uploaded ZIP or source file |
| `/api/detect` | GET | Detect which languages are present in a directory |
| `/api/file` | GET | Return source file contents for inline preview |
| `/api/diff` | POST | Compare two graph JSON snapshots |
| `/api/layers` | POST | Check for architectural layering violations |
| `/api/rules` | POST | Check custom dependency rule violations |
| `/api/simulate` | POST | Preview impact of node/edge removal |
| `/api/simulate-merge` | POST | Preview impact of merging or splitting files |
| `/api/story` | POST | Generate a story-mode walkthrough |
| `/api/config` | GET | Expose configuration flags to the frontend |
| `/api/csrf-token` | GET | Get CSRF token for write operations |

### Query parameters for `/api/graph`

`dir` (directory to scan), `upload_token` (re-scan a previously uploaded/cloned project), `mode` (set to `auto` for language detection), `hide_system`, `hide_isolated`, `filter_dir`, and per-language toggles: `show_c`, `show_h`, `show_cpp`, `show_js`, `show_py`, `show_java`, `show_go`, `show_rust`, `show_cs`, `show_swift`, `show_ruby`, `show_kotlin`, `show_scala`, `show_php`, `show_dart`, `show_elixir`.

## Deployment

A `render.yaml` is included for deploying to Render as a Python web service with Gunicorn. The app listens on the port specified by the `PORT` environment variable.

## Security

The server includes rate limiting (configurable via `DEPGRAPH_RATE_LIMIT` and `DEPGRAPH_RATE_WINDOW` env vars), CSRF protection, directory traversal prevention (restricted to `DEPGRAPH_BASE_DIR`), and a 50 MB upload size limit.

## Testing

Frontend unit tests use Node.js 22's built-in test runner with zero npm dependencies. A custom JSDOM shim provides DOM APIs and `vm.runInThisContext` loads the vanilla JS modules into the test context.

```bash
node --test static/__tests__/query.test.js static/__tests__/analysis.test.js static/__tests__/exports.test.js
```

This runs 57 tests covering the query parser, depth warning computation, project insights, and DOT/Mermaid/Markdown export.

## Notes

- Directories and filenames containing `test` and directories containing `cmake` are skipped during parsing.
- `node_modules`, `__pycache__`, `.venv`, `vendor`, `target`, `bin`, `obj`, and `packages` directories are automatically skipped for their respective languages.
- JS/TS imports are resolved relative to the source file; extensionless imports probe `.js`, `.jsx`, `.ts`, `.tsx`, etc. and `index.*` files.
- Python imports resolve against the project tree, with stdlib detection to classify system vs. local imports.
- Go imports are resolved using the module path from `go.mod`.
- Rust `mod` declarations follow the standard `foo.rs` / `foo/mod.rs` convention.
- Java wildcard imports expand to all `.java` files in the matching package directory.
- C# `using` directives resolve namespaces to project files by stripping the root namespace prefix. System/framework namespaces (System, Microsoft, etc.) are classified as external.
- Swift `import` resolves module names to local `.swift` files or directories. System frameworks (Foundation, UIKit, SwiftUI, etc.) are classified as external.
- Ruby `require_relative` resolves relative to the source file; `require` resolves against the project tree. Standard library and popular gem names are classified as external.
- Kotlin `import` resolves package paths to project files; standard library packages (kotlin, kotlinx, java, javax, android) are classified as external.
- Scala `import` resolves package paths including grouped imports (`import foo.{Bar, Baz}`). Standard library and Akka packages are classified as external.
- PHP `use` resolves PSR-4 namespace paths to files; `require`/`include` resolve literal paths. Standard library functions and common framework namespaces are classified as external.
- Dart `import` resolves `package:` and relative paths. SDK packages (dart:core, dart:async, etc.) are classified as external.
- Elixir `alias`, `import`, `require`, and `use` resolve module names to file paths following Mix project conventions. Standard library modules (Kernel, Enum, etc.) are classified as external.
- The frontend depends on Cytoscape.js, cytoscape-dagre, and Prism.js from CDNs.
