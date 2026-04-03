# DepGraph

DepGraph is a lightweight Flask app for exploring source file dependencies as an interactive graph.

It scans source trees or uploaded archives, builds a dependency graph, highlights circular dependencies, and shows per-file reference counts in a browser UI.

## Supported Languages

- **C / C++** — parses `#include` directives (`.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`)
- **JavaScript / TypeScript** — parses `import` and `require()` statements (`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`)
- **Python** — parses `import` and `from ... import` statements, including relative imports (`.py`)
- **Java** — parses `import` and `import static` statements, including wildcard imports (`.java`)
- **Go** — parses `import` declarations (single and grouped), resolves local packages via `go.mod` (`.go`)
- **Rust** — parses `use`, `mod`, and `extern crate` declarations (`.rs`)
- **C#** — parses `using` directives, resolves namespaces to project files and directories (`.cs`)
- **Swift** — parses `import` declarations, resolves local modules to files and directories (`.swift`)
- **Ruby** — parses `require`, `require_relative`, and `load` statements (`.rb`)

Language detection is automatic — DepGraph scans the target directory and enables the relevant parsers based on which file types are present.

## Features

### Graph & Visualization

- Visualizes include/import relationships between source files as an interactive node-edge graph
- Sizes nodes by inbound reference count, colors nodes by directory for visual grouping
- Three layout algorithms: force-directed, hierarchical (dagre), and concentric — with animated transitions when switching between them
- Directory collapsing — toggle between a directory-level overview and the full file-level graph, with click-to-expand/collapse on any folder node
- Focus lens — a toggleable focus+context distortion that magnifies nodes near the cursor while shrinking distant ones for exploration without losing the big picture
- Minimap for orientation in large graphs with click-to-pan
- Inline source file preview with syntax highlighting (double-click any node)

### Analysis

- Detects and highlights circular dependencies using Tarjan's SCC algorithm
- Blast radius — click any file to see its direct and transitive dependents, with impact percentage
- Path finder — find the shortest dependency path between two files
- Simulate refactor — model file moves/deletes and preview how the graph would change
- Story mode — guided walkthrough of the dependency structure
- Unused file detection — identifies files with zero inbound references
- Query terminal — a mini query language for filtering nodes by metrics (e.g. `files where inbound > 3 and outbound > 2`, `files in cycles`)

### Filters & Controls

- Filters by file type, directory prefix, system/stdlib imports, and isolated nodes
- Quick Jump (Cmd+K / Ctrl+K) for instant file navigation
- Search for a file and center the graph on it
- Graph diff view — compare two graph snapshots to see added/removed nodes and edges
- Architectural layer checking — define layer ordering and detect violations
- Custom dependency rules — define forbidden or required dependency patterns

### Export & Deployment

- Exports the current graph as JSON, PNG, Graphviz DOT, or Mermaid
- Supports local directory scanning and ZIP/source-file uploads
- Light and dark theme support
- Keyboard shortcuts for all common actions (press **?** to see them)
- Deployable to Render (configuration included)

## Project Layout

- `app.py` — Flask server, multi-language parsing, graph construction, and upload handling
- `cli.py` — CLI entry point (`depgraph` command)
- `pyproject.toml` — package config for `pip install .`
- `static/index.html` — single-page frontend UI built with Cytoscape.js
- `static/app.js` — all frontend logic: graph rendering, layouts, analysis panels, keyboard shortcuts
- `static/style.css` — UI styles with light/dark theme support
- `render.yaml` — Render deployment configuration
- `test_dir/`, `test_cycle/`, `test_files/` — sample C/C++ source trees
- `test_py/`, `test_js/`, `test_java/`, `test_go/`, `test_rust/`, `test_csharp/`, `test_swift/`, `test_ruby/` — sample source trees for each language

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
```

Run `depgraph --help` for the full list of options.

## Web UI

Start the web server directly:

```bash
python app.py
```

The server runs on [http://localhost:8080](http://localhost:8080). Set the `PORT` environment variable to change the port, and `FLASK_DEBUG=true` to enable debug mode (shows the directory input and search bar).

## Using the App

### Scan a local directory

1. Launch the app.
2. Open the browser UI.
3. Enter a directory path in the directory input.
4. Click **Generate** — DepGraph auto-detects which languages are present and enables the appropriate parsers.

### Upload source files

Upload a `.zip` archive or any supported source file from the UI. ZIP uploads are extracted into a temporary directory before parsing.

### Filters and controls

- Toggle visibility per language group (C, headers, C++, JS/TS, Python, Java, Go, Rust, C#, Swift, Ruby)
- Hide system headers (C/C++ angle-bracket includes) and external/stdlib packages
- Hide isolated nodes with no graph edges
- Filter the graph to a relative directory prefix
- Search for a file and center the graph on it
- Quick Jump (Cmd+K / Ctrl+K) to instantly find and navigate to any file
- Click filenames in the sidebar to center matching nodes
- Toggle node visibility from the reference-count list

### Keyboard shortcuts

Press **?** in the UI to see all available keyboard shortcuts.

## Cycle Detection

DepGraph computes strongly connected components (Tarjan's algorithm) to detect dependency cycles. Cyclic edges are highlighted in red, the sidebar lists each detected cycle, and a banner warns when circular dependencies are present.

## Graph Diff

Compare two dependency graph snapshots to visualize what changed. Added nodes and edges are highlighted, removed ones are shown as faded, and unchanged elements retain their normal appearance. This is useful for understanding how a refactor or PR affected the dependency structure.

## Architectural Rules

### Layer checking

Define an ordered list of architectural layers (e.g. `ui → service → data → util`) and DepGraph will flag any dependency that flows in the wrong direction — a lower layer importing from a higher one.

### Dependency rules

Define custom rules to enforce dependency constraints:

- **Forbidden** — a source pattern must not depend on a target pattern
- **Required** — a source pattern must only depend on a target pattern

Patterns use substring matching against file paths.

## Exports

The UI can export the current graph as JSON, PNG, DOT (Graphviz), or Mermaid.

## API

### `GET /api/graph`

Returns the dependency graph for a local directory.

Query parameters:

- `dir` — directory to scan (default: `.`)
- `mode` — set to `auto` to detect languages automatically
- `hide_system` — hide system/stdlib imports (`true` / `false`)
- `show_c`, `show_h`, `show_cpp` — toggle C/header/C++ files (default `true`)
- `show_js`, `show_py`, `show_java`, `show_go`, `show_rust`, `show_cs`, `show_swift`, `show_ruby` — toggle other languages (default `false`)
- `hide_isolated` — hide nodes with no edges (`true` / `false`)
- `filter_dir` — optional path prefix filter

### `POST /api/upload`

Multipart form data. Accepts a ZIP archive or individual source file along with the same filter parameters as `/api/graph`.

- `file` — the file to upload
- Same filter parameters as above

### `GET /api/detect`

Scans a directory and returns which language groups are present.

- `dir` — directory to scan (default: `.`)

### `GET /api/file`

Returns the contents of a source file for inline preview.

- `dir` — base directory
- `path` — relative file path within that directory

### `POST /api/diff`

Accepts two graph JSON payloads (`old` and `new`) and returns a merged diff view with nodes and edges annotated as `added`, `removed`, or `unchanged`.

### `POST /api/layers`

Accepts a layer ordering and a graph payload, returns any layering violations.

### `POST /api/rules`

Accepts a list of dependency rules and a graph payload, returns any rule violations.

All graph endpoints return JSON with `nodes`, `edges`, `has_cycles`, and `cycles`.

## Deployment

A `render.yaml` is included for deploying to Render as a Python web service with Gunicorn. The app listens on the port specified by the `PORT` environment variable.

## Notes

- Directories and filenames containing `test` and directories containing `cmake` are skipped during parsing.
- `node_modules`, `__pycache__`, `.venv`, `vendor`, `target`, `bin`, `obj`, and `packages` directories are automatically skipped for their respective languages.
- JS/TS imports are resolved relative to the source file; extensionless imports probe `.js`, `.jsx`, `.ts`, `.tsx`, etc. and `index.*` files.
- Python imports resolve against the project tree, with stdlib detection to classify system vs. local imports.
- Go imports are resolved using the module path from `go.mod`.
- Rust `mod` declarations follow the standard `foo.rs` / `foo/mod.rs` convention.
- Java wildcard imports expand to all `.java` files in the matching package directory.
- C# `using` directives reference namespaces — DepGraph resolves them to project files by stripping the root namespace prefix and matching against directories and file names. System/framework namespaces (System, Microsoft, etc.) are classified as external.
- Swift `import` declarations resolve module names to local `.swift` files or directories. System frameworks (Foundation, UIKit, SwiftUI, etc.) are classified as external.
- Ruby `require_relative` paths resolve relative to the source file; `require` paths resolve against the project tree. Standard library and popular gem names are classified as external.
- Uploaded files are processed in a temporary directory that persists until the next upload (to support file preview).
- The frontend depends on Cytoscape.js and cytoscape-dagre from CDNs.
