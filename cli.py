#!/usr/bin/env python3
"""DepGraph CLI — analyze source file dependencies from the terminal.

Usage:
    depgraph ./my-project              # auto-detect languages, print tree
    depgraph ./src --lang rust         # force Rust parsing
    depgraph ./src --json              # export JSON
    depgraph ./src --dot               # export DOT (Graphviz)
    depgraph ./src --mermaid           # export Mermaid diagram
    depgraph ./src --json -o graph.json
    depgraph ./src --serve             # launch web UI
"""

import argparse
import json
import os
import sys
import webbrowser

# Import the core graph engine (same module powers the web UI)
from graph import build_graph as _build_graph, detect_languages as _detect_languages


# ---------------------------------------------------------------------------
# Terminal colours (disabled when piping to a file)
# ---------------------------------------------------------------------------

_USE_COLOR = hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


def _c(code, text):
    return f"\033[{code}m{text}\033[0m" if _USE_COLOR else text


def _bold(t):    return _c("1", t)
def _dim(t):     return _c("2", t)
def _red(t):     return _c("31", t)
def _green(t):   return _c("32", t)
def _yellow(t):  return _c("33", t)
def _cyan(t):    return _c("36", t)
def _magenta(t): return _c("35", t)


# ---------------------------------------------------------------------------
# Output formatters
# ---------------------------------------------------------------------------

def _format_tree(result, directory):
    """Print a coloured dependency tree to stdout."""
    nodes = {n["data"]["id"]: n["data"] for n in result["nodes"]}
    adj = {}
    for e in result["edges"]:
        adj.setdefault(e["data"]["source"], []).append(e["data"]["target"])

    cycle_set = set()
    for scc in result.get("cycles", []):
        if len(scc) > 1:
            cycle_set.update(scc)

    # Find root nodes (nothing points to them, or they have most dependents)
    all_targets = {e["data"]["target"] for e in result["edges"]}
    roots = sorted(n for n in nodes if n not in all_targets)
    if not roots:
        # Everything is in a cycle or has inbound edges — pick highest impact
        roots = sorted(nodes, key=lambda n: nodes[n].get("impact", 0), reverse=True)[:5]

    # Header
    dir_name = os.path.basename(os.path.abspath(directory))
    node_count = len(nodes)
    edge_count = len(result["edges"])
    print()
    print(f"  {_bold('DepGraph')}  {_dim('·')}  {dir_name}")
    print(f"  {_dim(f'{node_count} files  ·  {edge_count} dependencies')}")
    if result.get("has_cycles"):
        cycle_count = len(result.get("cycles", []))
        print(f"  {_red(f'⚠  {cycle_count} circular dependency group(s) detected')}")
    print()

    # Print tree
    visited = set()

    def _print_node(node_id, prefix="", is_last=True, depth=0):
        if depth > 8:
            print(f"{prefix}{'└── ' if is_last else '├── '}{_dim('...')}")
            return
        connector = "└── " if is_last else "├── "
        extension = "    " if is_last else "│   "

        # Format node label
        label = node_id
        data = nodes.get(node_id, {})
        in_deg = data.get("impact", 0)
        d = data.get("depth", 0)

        badges = []
        if node_id in cycle_set:
            label = _red(node_id)
            badges.append(_red("cycle"))
        elif in_deg >= 5:
            label = _yellow(node_id)
        else:
            label = _cyan(node_id)

        if d >= 5:
            badges.append(_yellow(f"depth:{d}"))

        badge_str = f"  {_dim('(')}{'  '.join(badges)}{_dim(')')}" if badges else ""
        print(f"{prefix}{connector}{label}{badge_str}")

        if node_id in visited:
            children = adj.get(node_id, [])
            if children:
                print(f"{prefix}{extension}{_dim('(already shown)')}")
            return
        visited.add(node_id)

        children = sorted(adj.get(node_id, []))
        for i, child in enumerate(children):
            _print_node(child, prefix + extension, i == len(children) - 1, depth + 1)

    for i, root in enumerate(roots):
        _print_node(root, "  ", i == len(roots) - 1, 0)

    # Warnings summary
    warnings = result.get("depth_warnings", [])
    if warnings:
        print()
        print(f"  {_bold('Warnings')}")
        for w in warnings[:10]:
            icon = _red("●") if w["severity"] == "critical" else _yellow("●")
            reasons = ", ".join(w["reasons"])
            print(f"  {icon} {w['file']}  {_dim(reasons)}")

    # Coupling summary
    coupling = result.get("coupling", [])
    if coupling:
        print()
        print(f"  {_bold('Directory coupling')}")
        for c in coupling[:5]:
            bar_len = int(c["score"] * 20)
            bar = _magenta("█" * bar_len) + _dim("░" * (20 - bar_len))
            edge_count = c["cross_edges"]
            print(f"  {bar}  {c['dir1']} ↔ {c['dir2']}  {_dim(f'({edge_count} edges)')}")

    print()


def _format_json(result):
    """Return pretty-printed JSON string."""
    return json.dumps(result, indent=2)


def _format_dot(result):
    """Return a Graphviz DOT representation."""
    lines = [
        'digraph DependencyGraph {',
        '  node [shape=box, style=filled, fontname="Inter"];',
        '  rankdir=LR;',
    ]
    for n in result["nodes"]:
        nid = n["data"]["id"]
        color = n["data"].get("color", "#ccc")
        lines.append(f'  "{nid}" [fillcolor="{color}"];')
    for e in result["edges"]:
        src = e["data"]["source"]
        tgt = e["data"]["target"]
        is_cycle = "classes" in e and "cycle" in e.get("classes", "")
        if is_cycle:
            lines.append(f'  "{src}" -> "{tgt}" [color="red", penwidth=2];')
        else:
            color = e["data"].get("color", "#94a3b8")
            lines.append(f'  "{src}" -> "{tgt}" [color="{color}"];')
    lines.append("}")
    return "\n".join(lines)


def _format_mermaid(result):
    """Return a Mermaid flowchart."""
    lines = ["graph LR"]
    # Sanitise IDs for Mermaid (replace slashes, dots)
    def _mid(s):
        return s.replace("/", "_").replace(".", "_").replace("-", "_")
    for n in result["nodes"]:
        nid = n["data"]["id"]
        lines.append(f'  {_mid(nid)}["{nid}"]')
    for e in result["edges"]:
        src = _mid(e["data"]["source"])
        tgt = _mid(e["data"]["target"])
        is_cycle = "classes" in e and "cycle" in e.get("classes", "")
        if is_cycle:
            lines.append(f"  {src} -.->|cycle| {tgt}")
        else:
            lines.append(f"  {src} --> {tgt}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        prog="depgraph",
        description="Analyze and visualize source file dependencies.",
        epilog="Examples:\n"
               "  depgraph ./src\n"
               "  depgraph ./src --lang rust --json -o deps.json\n"
               "  depgraph ./src --dot | dot -Tpng -o graph.png\n"
               "  depgraph ./src --serve\n",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("directory", nargs="?", default=".",
                        help="directory to analyse (default: current dir)")

    # Language selection
    parser.add_argument("--lang", "-l", default="auto",
                        choices=["auto", "c", "cpp", "js", "py", "python",
                                 "java", "go", "rust", "cs", "csharp"],
                        help="language mode (default: auto-detect)")

    # Output format (mutually exclusive)
    fmt = parser.add_mutually_exclusive_group()
    fmt.add_argument("--json", action="store_true", help="output JSON")
    fmt.add_argument("--dot", action="store_true", help="output Graphviz DOT")
    fmt.add_argument("--mermaid", action="store_true", help="output Mermaid diagram")
    fmt.add_argument("--serve", action="store_true",
                     help="start web UI and open browser")

    # Filters
    parser.add_argument("--hide-external", action="store_true",
                        help="hide system / external imports")
    parser.add_argument("--hide-isolated", action="store_true",
                        help="hide files with no dependencies")
    parser.add_argument("--filter-dir", default="",
                        help="only show files under this subdirectory")

    # Output file
    parser.add_argument("-o", "--output", metavar="FILE",
                        help="write output to FILE instead of stdout")

    # Server options
    parser.add_argument("--port", type=int, default=8080,
                        help="port for --serve mode (default: 8080)")

    args = parser.parse_args()

    directory = os.path.abspath(args.directory)
    if not os.path.isdir(directory):
        print(f"Error: '{args.directory}' is not a directory.", file=sys.stderr)
        sys.exit(1)

    # --serve: start the Flask web UI
    if args.serve:
        os.environ.setdefault("FLASK_DEBUG", "true")
        os.environ["DEPGRAPH_BASE_DIR"] = os.path.dirname(directory)
        from app import app
        url = f"http://localhost:{args.port}"
        print(f"Starting DepGraph web UI at {_bold(url)}")
        print(f"Analyzing: {directory}")
        print(_dim("Press Ctrl+C to stop.\n"))
        webbrowser.open(url)
        app.run(host="0.0.0.0", port=args.port, debug=True)
        return

    # Detect languages
    detected = _detect_languages(directory)

    # Build language flags from --lang
    lang = args.lang
    if lang in ("python",):
        lang = "py"
    if lang in ("csharp",):
        lang = "cs"

    if lang == "auto":
        show_c = detected["has_c"]
        show_h = detected["has_h"]
        show_cpp = detected["has_cpp"]
        show_js = detected["has_js"]
        show_py = detected["has_py"]
        show_java = detected["has_java"]
        show_go = detected["has_go"]
        show_rust = detected["has_rust"]
        show_cs = detected["has_cs"]
    else:
        show_c = lang == "c"
        show_h = lang in ("c", "cpp")
        show_cpp = lang == "cpp"
        show_js = lang == "js"
        show_py = lang == "py"
        show_java = lang == "java"
        show_go = lang == "go"
        show_rust = lang == "rust"
        show_cs = lang == "cs"

    # Build graph
    result = _build_graph(
        directory,
        hide_system=args.hide_external,
        show_c=show_c, show_h=show_h, show_cpp=show_cpp,
        show_js=show_js, show_py=show_py, show_java=show_java,
        show_go=show_go, show_rust=show_rust, show_cs=show_cs,
        hide_isolated=args.hide_isolated,
        filter_dir=args.filter_dir,
    )

    if not result["nodes"]:
        print("No source files found.", file=sys.stderr)
        detected_langs = [k.replace("has_", "") for k, v in detected.items() if v]
        if detected_langs:
            print(f"Detected languages: {', '.join(detected_langs)}", file=sys.stderr)
            if lang != "auto":
                print(f"Try: depgraph {args.directory} --lang auto", file=sys.stderr)
        sys.exit(1)

    # Format output
    if args.json:
        output = _format_json(result)
    elif args.dot:
        output = _format_dot(result)
    elif args.mermaid:
        output = _format_mermaid(result)
    else:
        # Default: terminal tree
        _format_tree(result, directory)
        return

    # Write to file or stdout
    if args.output:
        with open(args.output, "w") as f:
            f.write(output)
            f.write("\n")
        print(f"Written to {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
