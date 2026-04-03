# DepGraph

DepGraph is a lightweight Flask app for exploring source file dependencies as an interactive graph.

It scans source trees or uploaded archives, builds a dependency graph, highlights circular dependencies, and shows per-file reference counts in a browser UI.

## Supported Languages

- **C / C++** — parses `#include` directives (`.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`)
- **JavaScript / TypeScript** — parses `import` and `require()` statements (`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`)

## Features

- Visualizes include/import relationships between source files
- Supports local directory scanning and ZIP/source-file uploads
- Detects and highlights circular dependencies
- Sizes nodes by inbound reference count
- Filters by file type, directory prefix, system headers, and isolated nodes
- Exports the current graph as JSON, PNG, or Graphviz DOT
- Includes light and dark theme support

## Project Layout

- `app.py` — Flask server, file parsing, graph construction, and upload handling
- `static/index.html` — single-page frontend UI built with Cytoscape.js
- `test_dir/`, `test_cycle/`, `test_files/` — sample source trees for local verification
- `.gitignore` — excludes caches, IDE config, and environment files

## Requirements

- Python 3
- Flask

Install dependencies with:

```bash
pip install flask
```

## Running Locally

Start the application from the repository root:

```bash
python app.py
```

The server runs on:

- [http://localhost:8080](http://localhost:8080)

## Using the App

### Scan a local directory

1. Launch the app.
2. Open the browser UI.
3. Enter a directory path in the directory input.
4. Click **Load Graph**.

### Upload source files

- Upload a `.zip` or any supported source file from the UI.
- The app extracts ZIP uploads into a temporary directory before parsing.

### Filters and controls

- Hide system headers (C/C++ angle-bracket includes) and external packages (bare JS/TS imports)
- Toggle C, header, C++, and JS/TS file visibility
- Hide isolated nodes with no graph edges
- Filter the graph to a relative directory prefix
- Search for a file and center the graph on it
- Click filenames in the sidebar to center matching nodes
- Toggle node visibility from the reference-count list

## Cycle Detection

DepGraph computes strongly connected components to detect dependency cycles.

- Cyclic edges are highlighted in red
- The sidebar lists each detected cycle
- The banner warns when circular dependencies are present

## Exports

The UI can export the current graph as:

- JSON
- PNG
- DOT

## API

### `GET /api/graph`

Query parameters:

- `dir` — directory to scan, default: `.`
- `hide_system` — `true` or `false`
- `show_c` — `true` or `false`
- `show_h` — `true` or `false`
- `show_cpp` — `true` or `false`
- `show_js` — `true` or `false` (JS/TS files, default `false`)
- `hide_isolated` — `true` or `false`
- `filter_dir` — optional path prefix filter

### `POST /api/upload`

Multipart form data:

- `file` — ZIP archive or supported source file
- `hide_system`
- `show_c`
- `show_h`
- `show_cpp`
- `show_js`
- `hide_isolated`
- `filter_dir`

Returns graph JSON with:

- `nodes`
- `edges`
- `has_cycles`
- `cycles`

## Notes

- Directories and filenames containing `test` and directories containing `cmake` are skipped during parsing.
- `node_modules` directories are automatically skipped when JS/TS scanning is enabled.
- JS/TS imports are resolved relative to the source file; extensionless imports probe `.js`, `.jsx`, `.ts`, `.tsx`, etc. and `index.*` files.
- Uploaded files are processed in a temporary directory and removed after the request completes.
- The frontend depends on Cytoscape.js from a CDN.
