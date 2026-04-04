# DepGraph

DepGraph is a lightweight tool for exploring source file dependencies as an interactive graph. It scans source trees or uploaded archives, builds a dependency graph, highlights circular dependencies, and provides deep analysis tools — all in a browser UI or from the command line.

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

Language detection is automatic — DepGraph scans the target directory and enables the relevant parsers based on which file types are present.

## Features

### Visualization

- Interactive node-edge graph powered by Cytoscape.js with three layout algorithms: force-directed, hierarchical (dagre), and concentric
- Treemap view for a heat-map style overview sized by file count and colored by a chosen metric (inbound, outbound, depth, impact, instability)
- Matrix view showing an N×N dependency grid with directory boundary markers
- Directory collapsing — toggle between a directory-level overview and the full file-level graph, with click-to-expand/collapse on any folder
- Focus lens — a fisheye distortion that magnifies nodes near the cursor while shrinking distant ones (toggle with `L`)
- Minimap for orientation in large graphs with click-to-pan
- Inline source preview with syntax highlighting (double-click any node)
- Nodes sized by inbound reference count, colored by directory
- Animated transitions when switching layouts or views

### Analysis Tools

- **Cycle detection** — Tarjan's SCC algorithm highlights circular dependencies with red edges and a warning banner
- **Blast radius** — select a file to see its direct and transitive dependents, with impact percentage and depth-stratified drill-down
- **Path finder** — find the shortest dependency path between any two files
- **Refactor simulator** — model file moves or deletions and preview how the graph would change
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

- **Filters** dropdown — filter by subdirectory, toggle system/external imports and isolated nodes, select language mode
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
├── app.py           — Flask server, API routes, upload handling, security
├── graph.py         — core graph engine (build_graph, detect_languages, find_sccs)
├── parsers.py       — language-specific import resolution for all 9 languages
├── cli.py           — CLI entry point (depgraph command)
├── pyproject.toml   — package config (pip install .)
├── requirements.txt — Flask, Gunicorn, Werkzeug
├── render.yaml      — Render deployment config
├── action.yml       — GitHub Action definition
├── static/
│   ├── index.html   — single-page frontend
│   ├── app.js       — all frontend logic (~270 functions)
│   ├── style.css    — UI styles with light/dark theme
│   └── tour.js      — guided tour system
├── tests/           — sample source trees for each supported language
└── examples/        — example outputs (Mermaid diagram)
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

DepGraph includes a GitHub Action that automatically comments a dependency diff on pull requests. When a PR changes import/include relationships, the action posts a summary of added/removed files and dependencies.

### Setup

Add this workflow to your repository at `.github/workflows/depgraph.yml`:

```yaml
name: Dependency Diff

on:
  pull_request:
    branches: [main]

permissions:
  pull-requests: write

jobs:
  depgraph:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: your-username/DepGraph@main
        with:
          path: '.'
```

### Inputs

| Input | Default | Description |
|---|---|---|
| `path` | `.` | Path to the source directory to analyze |
| `lang` | `auto` | Language mode (auto, c, cpp, js, py, java, go, rust, cs, swift, ruby) |
| `hide-external` | `true` | Hide system/stdlib imports |
| `hide-isolated` | `true` | Hide files with no dependencies |
| `github-token` | `${{ github.token }}` | Token for posting PR comments |

The action checks out the base branch into a temporary worktree, runs `depgraph --diff` to compare dependencies, and posts a collapsible Markdown comment on the PR. If there are no dependency changes, it stays silent. Previous DepGraph comments are replaced on each push to keep the PR clean.

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

**Tools:** Layers (architectural layer violations), Rules (custom forbidden/required dependency patterns), Path Finder (shortest path between two files), Diff (compare two graph snapshots), Simulate (model file removals and preview impact).

**More:** Story Mode (generated walkthrough of the dependency structure).

## API

All graph endpoints return JSON with `nodes`, `edges`, `has_cycles`, `cycles`, `unused_files`, `coupling`, and `depth_warnings`.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/graph` | GET | Build graph from a local directory |
| `/api/upload` | POST | Build graph from an uploaded ZIP or source file |
| `/api/detect` | GET | Detect which languages are present in a directory |
| `/api/file` | GET | Return source file contents for inline preview |
| `/api/diff` | POST | Compare two graph JSON snapshots |
| `/api/layers` | POST | Check for architectural layering violations |
| `/api/rules` | POST | Check custom dependency rule violations |
| `/api/simulate` | POST | Preview impact of node/edge removal |
| `/api/story` | POST | Generate a story-mode walkthrough |
| `/api/config` | GET | Expose configuration flags to the frontend |
| `/api/csrf-token` | GET | Get CSRF token for write operations |

### Query parameters for `/api/graph`

`dir` (directory to scan), `mode` (set to `auto` for language detection), `hide_system`, `hide_isolated`, `filter_dir`, and per-language toggles: `show_c`, `show_h`, `show_cpp`, `show_js`, `show_py`, `show_java`, `show_go`, `show_rust`, `show_cs`, `show_swift`, `show_ruby`.

## Deployment

A `render.yaml` is included for deploying to Render as a Python web service with Gunicorn. The app listens on the port specified by the `PORT` environment variable.

## Security

The server includes rate limiting (configurable via `DEPGRAPH_RATE_LIMIT` and `DEPGRAPH_RATE_WINDOW` env vars), CSRF protection, directory traversal prevention (restricted to `DEPGRAPH_BASE_DIR`), and a 50 MB upload size limit.

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
- The frontend depends on Cytoscape.js, cytoscape-dagre, and Prism.js from CDNs.
