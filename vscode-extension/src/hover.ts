import * as vscode from 'vscode';
import {
  getCachedGraph,
  getDependencies,
  getDependents,
  getNodeData,
  getBlastRadius,
  GraphData,
} from './engine';

// ── Import-line regex patterns (mirrors parsers.py) ──────────────

const IMPORT_PATTERNS: { langs: string[]; pattern: RegExp }[] = [
  // JS/TS: import ... from 'foo' | require('foo')
  {
    langs: ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'],
    pattern: /(?:from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/,
  },
  // Python: import foo | from foo import bar
  {
    langs: ['python'],
    pattern: /^\s*(?:from\s+([\w.]+)|import\s+([\w.]+))/,
  },
  // C/C++: #include "foo.h" | #include <foo.h>
  {
    langs: ['c', 'cpp'],
    pattern: /#include\s*[<"]([^>"]+)[>"]/,
  },
  // Java: import foo.bar.Baz
  {
    langs: ['java'],
    pattern: /^\s*import\s+(?:static\s+)?([\w.]+)/,
  },
  // Go: "github.com/foo/bar"
  {
    langs: ['go'],
    pattern: /^\s*"([^"]+)"/,
  },
  // Rust: use foo::bar
  {
    langs: ['rust'],
    pattern: /^\s*(?:pub\s+)?use\s+([\w:]+)/,
  },
  // C#: using Foo.Bar
  {
    langs: ['csharp'],
    pattern: /^\s*using\s+(?:static\s+)?([\w.]+)/,
  },
  // Swift: import Foo
  {
    langs: ['swift'],
    pattern: /^\s*import\s+(\w+)/,
  },
  // Ruby: require 'foo' | require_relative 'foo'
  {
    langs: ['ruby'],
    pattern: /(?:require_relative|require|load)\s+['"]([^'"]+)['"]/,
  },
  // Kotlin: import com.example.Foo
  {
    langs: ['kotlin'],
    pattern: /^\s*import\s+([\w.*]+)(?:\s+as\s+\w+)?/,
  },
  // Scala: import com.example.Foo | import com.example.{Foo, Bar}
  {
    langs: ['scala'],
    pattern: /^\s*import\s+([\w.*]+(?:\.\{[^}]+\})?)/,
  },
  // PHP: use App\Models\User | require 'path' | include 'path'
  {
    langs: ['php'],
    pattern: /(?:^\s*use\s+([\w\\]+)|(?:require_once|include_once|require|include)\s*\(?\s*['"]([^'"]+)['"]\s*\)?)/,
  },
  // Dart: import 'package:foo/bar.dart' | import 'path/to/file.dart'
  {
    langs: ['dart'],
    pattern: /^\s*import\s+['"]([^'"]+)['"]/,
  },
  // Elixir: alias/import/use/require Foo.Bar
  {
    langs: ['elixir'],
    pattern: /^\s*(?:alias|import|use|require)\s+([\w.]+)/,
  },
  // Lua: require("module") | require 'module'
  {
    langs: ['lua'],
    pattern: /require\s*[\(]?\s*['"]([^'"]+)['"]\s*[\)]?/,
  },
  // Zig: @import("file.zig")
  {
    langs: ['zig'],
    pattern: /@import\s*\(\s*"([^"]+)"\s*\)/,
  },
  // Haskell: import Module.Name | import qualified Module.Name
  {
    langs: ['haskell'],
    pattern: /^\s*import\s+(?:qualified\s+)?([\w.]+)/,
  },
  // R: library(pkg) | require(pkg) | source("file.R")
  {
    langs: ['r'],
    pattern: /(?:library|require)\s*\(\s*['"]?([\w.]+)['"]?\s*\)|source\s*\(\s*['"]([^'"]+)['"]\s*\)/,
  },
];

// ── Hover provider ───────────────────────────────────────────────

export class DepGraphHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const graph = getCachedGraph();
    if (!graph) { return undefined; }

    const line = document.lineAt(position).text;
    const langId = document.languageId;

    // Find the import target on this line
    const importTarget = extractImportTarget(line, langId);
    if (!importTarget) { return undefined; }

    // Find matching node(s) in the graph
    const matchedId = findNodeForImport(graph, importTarget);
    if (!matchedId) { return undefined; }

    // Build the hover content
    const md = buildMiniGraph(graph, matchedId);
    return new vscode.Hover(md);
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function extractImportTarget(line: string, langId: string): string | undefined {
  for (const { langs, pattern } of IMPORT_PATTERNS) {
    if (!langs.includes(langId)) { continue; }
    const m = pattern.exec(line);
    if (m) {
      // Return the first non-undefined capture group
      return m[1] ?? m[2] ?? m[3];
    }
  }
  return undefined;
}

function findNodeForImport(graph: GraphData, target: string): string | undefined {
  const nodeIds = graph.nodes.map(n => n.data.id);

  // Exact match
  const exact = nodeIds.find(id => id === target);
  if (exact) { return exact; }

  // Ends-with match (e.g. "utils/helpers" matches "src/utils/helpers.ts")
  const suffix = nodeIds.find(id => {
    const bare = id.replace(/\.[^.]+$/, ''); // strip extension
    return bare === target || bare.endsWith('/' + target) || id.endsWith('/' + target);
  });
  if (suffix) { return suffix; }

  // Fuzzy: import path segments match node path segments
  // e.g. Python "from models.user import User" → "models/user.py"
  const normalized = target.replace(/\./g, '/');
  const fuzzy = nodeIds.find(id => {
    const bare = id.replace(/\.[^.]+$/, '');
    return bare === normalized || bare.endsWith('/' + normalized);
  });
  if (fuzzy) { return fuzzy; }

  return undefined;
}

function buildMiniGraph(graph: GraphData, fileId: string): vscode.MarkdownString {
  const node = getNodeData(graph, fileId);
  const deps = getDependencies(graph, fileId);
  const dependents = getDependents(graph, fileId);
  const blast = getBlastRadius(graph, fileId);

  // Check if in a cycle
  const inCycle = graph.has_cycles && graph.cycles.some(c => c.includes(fileId));

  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;

  // Header
  md.appendMarkdown(`**$(type-hierarchy) ${fileId}**\n\n`);

  // Metrics line
  if (node) {
    const d = node.data;
    md.appendMarkdown(
      `depth \`${d.depth}\` · impact \`${d.impact}\` · stability \`${d.stability.toFixed(2)}\` · blast radius \`${blast.size}\`\n\n`
    );
  }

  if (inCycle) {
    md.appendMarkdown(`$(warning) **Part of a dependency cycle**\n\n`);
  }

  // ── Mini graph: who imports this ← FILE → what it imports ──

  md.appendMarkdown(`---\n\n`);

  // Imported by (dependents) — max 8
  if (dependents.length > 0) {
    md.appendMarkdown(`$(arrow-left) **Imported by** (${dependents.length})\n\n`);
    const shown = dependents.slice(0, 8);
    for (const dep of shown) {
      const depInCycle = inCycle && graph.cycles.some(c => c.includes(dep) && c.includes(fileId));
      const icon = depInCycle ? '$(arrow-swap)' : '$(file)';
      md.appendMarkdown(`${icon} \`${dep}\`\n\n`);
    }
    if (dependents.length > 8) {
      md.appendMarkdown(`*… and ${dependents.length - 8} more*\n\n`);
    }
  } else {
    md.appendMarkdown(`$(arrow-left) *No dependents (unused or entry point)*\n\n`);
  }

  // Imports (dependencies) — max 8
  if (deps.length > 0) {
    md.appendMarkdown(`$(arrow-right) **Imports** (${deps.length})\n\n`);
    const shown = deps.slice(0, 8);
    for (const dep of shown) {
      // Show 2nd-level deps inline for a richer mini-graph
      const subDeps = getDependencies(graph, dep);
      const depInCycle = inCycle && graph.cycles.some(c => c.includes(dep) && c.includes(fileId));
      const icon = depInCycle ? '$(arrow-swap)' : '$(file)';

      if (subDeps.length > 0 && subDeps.length <= 4) {
        const subList = subDeps.map(s => `\`${s}\``).join(', ');
        md.appendMarkdown(`${icon} \`${dep}\` → ${subList}\n\n`);
      } else if (subDeps.length > 4) {
        const subList = subDeps.slice(0, 3).map(s => `\`${s}\``).join(', ');
        md.appendMarkdown(`${icon} \`${dep}\` → ${subList}, *+${subDeps.length - 3} more*\n\n`);
      } else {
        md.appendMarkdown(`${icon} \`${dep}\`\n\n`);
      }
    }
    if (deps.length > 8) {
      md.appendMarkdown(`*… and ${deps.length - 8} more*\n\n`);
    }
  } else {
    md.appendMarkdown(`$(arrow-right) *No imports (leaf node)*\n\n`);
  }

  return md;
}
