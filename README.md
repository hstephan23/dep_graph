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

Language detection is automatic — DepGraph scans the target directory and enables the relevant parsers based on which file types are present.

## Features

- Visualizes include/import relationships between source files
- Supports local directory scanning and ZIP/source-file uploads
- Detects and highlights circular dependencies using Tarjan's SCC algorithm
- Sizes nodes by inbound reference count
- Colors nodes by directory for visual grouping
- Filters by file type, directory prefix, system/stdlib imports, and isolated nodes
- Inline source file preview with syntax highlighting
- Graph diff view — compare two graph snapshots to see added/removed nodes and edges
- Architectural layer checking — define layer ordering and detect violations
- Custom dependency rules — define forbidden or required dependency patterns
- Exports the current graph as JSON, PNG, or Graphviz DOT
- Multiple layout options (force-directed, dagre/hierarchical)
- Light and dark theme support
- Keyboard shortcuts for common actions
- Deployable to Render (configuration included)

## Project Layout

- `app.py` — Flask server, multi-language parsing, graph construction, and upload handling
- `static/index.html` — single-page frontend UI built with Cytoscape.js
- `static/style.css` — UI styles with light/dark theme support
- `render.yaml` — Render deployment configuration
- `test_dir/`, `test_cycle/`, `test_files/` — sample C/C++ source trees
- `test_py/`, `test_js/`, `test_java/`, `test_go/`, `test_rust/` — sample source trees for each language

## Requirements

- Python 3
- Flask
- Gunicorn (for production deployment)

Install dependencies with:

```bash
pip install -r requirements.txt
```

## Running Locally

Start the application from the repository root:

```bash
python app.py
```

The server runs on [http://localhost:8080](http://localhost:8080). Set the `PORT` environment variable to change the port, and `FLASK_DEBUG=false` to disable debug mode.

## Using the App

### Scan a local directory

1. Launch the app.
2. Open the browser UI.
3. Enter a directory path in the directory input.
4. Click **Generate** — DepGraph auto-detects which languages are present and enables the appropriate parsers.

### Upload source files

Upload a `.zip` archive or any supported source file from the UI. ZIP uploads are extracted into a temporary directory before parsing.

### Filters and controls

- Toggle visibility per language group (C, headers, C++, JS/TS, Python, Java, Go, Rust)
- Hide system headers (C/C++ angle-bracket includes) and external/stdlib packages
- Hide isolated nodes with no graph edges
- Filter the graph to a relative directory prefix
- Search for a file and center the graph on it
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

The UI can export the current graph as JSON, PNG, or DOT (Graphviz).

## API

### `GET /api/graph`

Returns the dependency graph for a local directory.

Query parameters:

- `dir` — directory to scan (default: `.`)
- `mode` — set to `auto` to detect languages automatically
- `hide_system` — hide system/stdlib imports (`true` / `false`)
- `show_c`, `show_h`, `show_cpp` — toggle C/header/C++ files (default `true`)
- `show_js`, `show_py`, `show_java`, `show_go`, `show_rust` — toggle other languages (default `false`)
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
- `node_modules`, `__pycache__`, `.venv`, `vendor`, and `target` directories are automatically skipped for their respective languages.
- JS/TS imports are resolved relative to the source file; extensionless imports probe `.js`, `.jsx`, `.ts`, `.tsx`, etc. and `index.*` files.
- Python imports resolve against the project tree, with stdlib detection to classify system vs. local imports.
- Go imports are resolved using the module path from `go.mod`.
- Rust `mod` declarations follow the standard `foo.rs` / `foo/mod.rs` convention.
- Java wildcard imports expand to all `.java` files in the matching package directory.
- Uploaded files are processed in a temporary directory that persists until the next upload (to support file preview).
- The frontend depends on Cytoscape.js and cytoscape-dagre from CDNs.
