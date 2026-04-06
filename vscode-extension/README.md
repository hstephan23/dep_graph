# DepGraph for VS Code

Visualize and analyze source file dependencies directly in VS Code. This extension brings the full DepGraph analysis toolkit into the editor — interactive graphs, cycle detection, blast radius, file metrics, and import hover previews.

## Prerequisites

The extension uses the DepGraph CLI under the hood. Install it from the project root:

```bash
pip install .
```

This makes the `depgraph` command available, which the extension invokes to build graph data.

## Features

### Interactive Dependency Graph

Open the command palette and run **DepGraph: Show Dependency Graph** to launch a Cytoscape.js graph in a webview panel. The graph includes three layout modes (Force, Hierarchy, Concentric), file search, and a right-click context menu for focusing on individual files.

The graph uses transitive reduction to remove redundant edges, logarithmic node sizing so hubs don't dominate the view, weighted edges that visually emphasize important dependency paths (thicker, darker, more opaque), and a density-adaptive force layout that adjusts spacing based on graph complexity.

### Sidebar Views

Three tree views appear in the Explorer sidebar under a DepGraph section:

- **Dependencies** — files sorted by depth, expandable to show imports and imported-by lists
- **Cycles** — detected circular dependencies with member files
- **File Metrics** — files sorted by impact with per-file depth, stability, and reach percentage

### Tree View

A spacious hierarchical tree view shows downstream ("What breaks?") or upstream ("Depends on") dependencies for any file. Nodes display risk indicators, file-type badges, and in-degree counts. Click any node to focus the graph on that file.

### Import Hover Preview

Hover over any import statement to see a mini dependency graph for the imported file — its metrics (depth, impact, stability, blast radius), who imports it, and what it imports, with second-level dependencies shown inline. Cycle membership is flagged with a warning.

Supported across all 18 languages: C/C++, JavaScript/TypeScript, Python, Java, Go, Rust, C#, Swift, Ruby, Kotlin, Scala, PHP, Dart, Elixir, Lua, Zig, Haskell, and R.

### CodeLens

Inline annotations appear above each file showing inbound/outbound dependency counts, depth, impact, and stability.

### Diagnostics

The extension reports cycle membership, excessive dependency depth, and high-impact files as warnings in the Problems panel. The depth threshold is configurable via `depgraph.maxDepthWarning`.

### Commands

Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and search for "DepGraph":

| Command | Description |
|---|---|
| Show Dependency Graph | Open interactive graph in a webview panel |
| Find Dependency Cycles | List detected cycles in a quick-pick menu |
| Show Dependents of Current File | Quick-pick list of files that import the current file |
| Show Dependencies of Current File | Quick-pick list of files imported by the current file |
| Show Blast Radius of Current File | Highlight all transitive dependents |
| Refresh Graph | Rebuild graph data from disk |
| Export Graph as JSON | Write graph data to a JSON file |
| Export Graph as DOT | Write graph in Graphviz DOT format |
| Export Graph as Mermaid | Write graph as a Mermaid diagram |

### Context Menu

Right-click any file in the editor to access Show Dependents, Show Dependencies, and Blast Radius directly.

## Settings

Configure under `depgraph.*` in VS Code settings:

| Setting | Default | Description |
|---|---|---|
| `pythonPath` | `python3` | Path to the Python interpreter with depgraph installed |
| `language` | `auto` | Language mode — `auto` detects from file types, or force a specific language (c, cpp, js, py, java, go, rust, cs, swift, ruby, kotlin, scala, php, dart, elixir) |
| `hideExternal` | `true` | Hide system/external imports from the graph |
| `hideIsolated` | `false` | Hide files with no dependencies |
| `maxDepthWarning` | `8` | Depth threshold for diagnostic warnings |
| `autoRefresh` | `true` | Automatically refresh the graph when files change |

## Supported Languages

C, C++, JavaScript, TypeScript, Python, Java, Go, Rust, C#, Swift, Ruby, Kotlin, Scala, PHP, Dart, Elixir, Lua, Zig, Haskell, and R. Language detection is automatic based on which file types are present in the workspace.

## Development

```bash
cd vscode-extension
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host for testing. The extension compiles TypeScript from `src/` to `out/`.

## Architecture

| File | Purpose |
|---|---|
| `extension.ts` | Activation, command registration, file watchers |
| `engine.ts` | Spawns DepGraph CLI, caches and parses graph data |
| `sidebar.ts` | Tree view providers for dependencies, cycles, and metrics |
| `commands.ts` | Command implementations (graph, cycles, blast radius, export) |
| `webview.ts` | Interactive Cytoscape.js graph and tree view in a VS Code panel |
| `hover.ts` | Mini dependency graph on import hover (18 language patterns) |
| `codeLens.ts` | Inline dependency counts and metrics above files |
| `diagnostics.ts` | Cycle, depth, and high-impact warnings in Problems panel |
| `config.ts` | Reads workspace settings |
