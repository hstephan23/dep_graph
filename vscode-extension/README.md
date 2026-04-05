# Dep Graph

Visualize and explore file dependencies directly in VS Code. Dep Graph scans your workspace, builds an interactive dependency graph, detects circular imports, and gives you tools to understand the structure and health of your codebase.

## Supported Languages

C, C++, JavaScript, TypeScript, Python, Java, Go, Rust, C#, Swift, Ruby, Kotlin, Scala, PHP, Dart, and Elixir. Language detection is automatic based on the files in your workspace.

## Features

### Interactive Dependency Graph

Open the command palette and run **DepGraph: Show Dependency Graph** to see a full interactive visualization of your project's file dependencies. The graph supports three layout modes (force-directed, hierarchical, and concentric), plus a treemap view and a dependency matrix.

### Sidebar Views

Dep Graph adds a dedicated sidebar with three panels:

- **Dependencies** -- browse the dependency tree for any file
- **Cycles** -- see all circular dependency chains at a glance
- **File Metrics** -- view inbound/outbound counts, depth, impact, and stability per file

### Cycle Detection

Automatically finds circular dependencies using Tarjan's strongly connected components algorithm. Cycles are listed in the sidebar and highlighted in the graph with red edges.

### Blast Radius

Right-click any file and select **Show Blast Radius** to see every file that would be affected if it changed -- direct and transitive dependents, with impact percentage.

### CodeLens and Hover

Dep Graph adds inline CodeLens annotations showing dependency counts above import statements. Hover over an import to see a mini dependency summary without leaving your editor.

### Diagnostics

Files involved in circular dependencies are flagged with editor diagnostics so you can spot issues as you code.

### Context Menu

Right-click in any editor to quickly access **Show Dependents**, **Show Dependencies**, or **Blast Radius** for the current file.

### Export

Export your dependency graph as JSON, Graphviz DOT, or Mermaid for use in documentation or other tools.

## Commands

| Command | Description |
|---------|-------------|
| `DepGraph: Show Dependency Graph` | Open the interactive graph view |
| `DepGraph: Find Dependency Cycles` | List all circular dependencies |
| `DepGraph: Show Dependents of Current File` | Show what depends on this file |
| `DepGraph: Show Dependencies of Current File` | Show what this file depends on |
| `DepGraph: Show Blast Radius of Current File` | Show transitive impact |
| `DepGraph: Refresh Graph` | Re-scan and rebuild the graph |
| `DepGraph: Export Graph as JSON` | Export as JSON |
| `DepGraph: Export Graph as DOT` | Export as Graphviz DOT |
| `DepGraph: Export Graph as Mermaid` | Export as Mermaid diagram |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `depgraph.language` | `auto` | Language mode for dependency analysis |
| `depgraph.hideExternal` | `true` | Hide system/external imports from the graph |
| `depgraph.hideIsolated` | `false` | Hide files with no dependencies |
| `depgraph.maxDepthWarning` | `8` | Highlight files exceeding this dependency depth |
| `depgraph.autoRefresh` | `true` | Automatically refresh when files change |
| `depgraph.pythonPath` | `python3` | Path to Python interpreter |

## Requirements

Python 3.8+ must be available on your system. The extension uses the bundled DepGraph engine for parsing and analysis.

## License

MIT
