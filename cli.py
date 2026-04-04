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
    """Print a coloured dependency tree to stdout.

    Node colours follow the risk classification so your eye goes straight
    to problems:
    * red = critical (god files, cycles, extreme inbound)
    * orange = high influence
    * yellow = high dependency (over-coupled)
    * cyan/blue = normal
    * green = entry point / leaf
    * dim = system / external
    """
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
        roots = sorted(nodes, key=lambda n: nodes[n].get("impact", 0), reverse=True)[:5]

    # Summarise languages & risk breakdown
    lang_counts = {}
    risk_counts = {}
    for nd in nodes.values():
        lang = nd.get("language")
        if lang:
            lang_counts[lang] = lang_counts.get(lang, 0) + 1
        risk = nd.get("risk", "normal")
        risk_counts[risk] = risk_counts.get(risk, 0) + 1

    # Header
    dir_name = os.path.basename(os.path.abspath(directory))
    node_count = len(nodes)
    edge_count = len(result["edges"])
    print()
    print(f"  {_magenta('╺━━╸')} {_bold('DepGraph')}  {_dim('·')}  {dir_name}")
    print(f"  {_magenta('○─○')}  {_dim(f'{node_count} files  ·  {edge_count} dependencies')}")
    if lang_counts:
        lang_summary = ", ".join(f"{lang} ({cnt})" for lang, cnt in
                                 sorted(lang_counts.items(), key=lambda x: -x[1]))
        print(f"  {_dim('Languages:')} {lang_summary}")

    # Risk summary line
    risk_parts = []
    for rk, color_fn in [("critical", _red), ("high", _yellow),
                          ("warning", _yellow), ("entry", _green)]:
        cnt = risk_counts.get(rk, 0)
        if cnt:
            risk_parts.append(color_fn(f"{cnt} {rk}"))
    normal_cnt = risk_counts.get("normal", 0)
    if normal_cnt:
        risk_parts.append(_dim(f"{normal_cnt} normal"))
    if risk_parts:
        print(f"  {_dim('Health:')} {', '.join(risk_parts)}")

    if result.get("has_cycles"):
        cycle_count = len(result.get("cycles", []))
        print(f"  {_red(f'⚠  {cycle_count} circular dependency group(s) detected')}")
    print()

    # Colour helpers per risk level
    _risk_label_fn = {
        "critical": _red,
        "high":     _yellow,
        "warning":  _yellow,
        "normal":   _cyan,
        "entry":    _green,
        "system":   _dim,
    }

    # Print tree
    visited = set()

    def _print_node(node_id, prefix="", is_last=True, depth=0):
        if depth > 8:
            print(f"{prefix}{'└── ' if is_last else '├── '}{_dim('...')}")
            return
        connector = "└── " if is_last else "├── "
        extension = "    " if is_last else "│   "

        data = nodes.get(node_id, {})
        risk = data.get("risk", "normal")
        in_deg = data.get("in_degree", 0)
        out_deg = data.get("out_degree", 0)
        d = data.get("depth", 0)
        color_fn = _risk_label_fn.get(risk, _cyan)
        label = color_fn(node_id)

        # Contextual badges
        badges = []
        if risk == "critical":
            if node_id in cycle_set:
                badges.append(_red("cycle"))
            if in_deg >= 5:
                badges.append(_red(f"in:{in_deg}"))
        elif risk == "high":
            badges.append(_yellow(f"in:{in_deg}"))
        elif risk == "warning":
            badges.append(_yellow(f"out:{out_deg}"))
        elif risk == "entry":
            badges.append(_green("entry"))

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

    # Legend
    print()
    print(f"  {_dim('Legend:')} {_red('● critical')}  {_yellow('● high/warning')}  {_cyan('● normal')}  {_green('● entry')}  {_dim('● system')}")
    print()


def _format_json(result):
    """Return pretty-printed JSON string."""
    return json.dumps(result, indent=2)


def _format_dot(result, color_by="risk"):
    """Return a Graphviz DOT representation.

    *color_by* controls the colour scheme:
    * ``"risk"`` (default) — red/orange/yellow/blue/green by importance
    * ``"directory"`` — per-directory colours
    """
    from graph import RISK_COLORS, RISK_LABELS

    lines = [
        'digraph DependencyGraph {',
        '  graph [bgcolor="transparent", pad=0.5];',
        '  node [shape=box, style="filled,rounded", fontname="Inter", fontsize=10, margin="0.15,0.08"];',
        '  edge [arrowsize=0.7, color="#64748b"];',
        '  rankdir=LR;',
        '',
    ]

    # Group nodes by directory for subgraph clustering
    dir_nodes = {}
    for n in result["nodes"]:
        nid = n["data"]["id"]
        parts = nid.rsplit("/", 1)
        folder = parts[0] if len(parts) > 1 else "(root)"
        dir_nodes.setdefault(folder, []).append(n)

    def _node_attrs(n):
        """Build DOT attribute string for one node."""
        nd = n["data"]
        nid = nd["id"]
        in_deg = nd.get("in_degree", 0)
        out_deg = nd.get("out_degree", 0)
        risk = nd.get("risk", "normal")
        lang = nd.get("language") or "?"
        node_size = nd.get("node_size", 35)

        if color_by == "directory":
            fill = nd.get("dir_color", nd.get("color", "#e2e8f0"))
        else:
            fill = nd.get("risk_color", RISK_COLORS.get(risk, "#3b82f6"))

        # Scale width/height proportionally to node_size
        w = round(node_size / 35, 2)
        h = round(node_size / 70, 2)

        border = "#ef4444" if risk == "critical" else "#94a3b8"
        penwidth = "2.5" if risk == "critical" else "1"
        fontcolor = "#ffffff" if risk == "critical" else "#1e293b"
        tooltip = f'{nid} [{lang}] risk:{risk} in:{in_deg} out:{out_deg}'
        return (f'fillcolor="{fill}", color="{border}", penwidth={penwidth}, '
                f'fontcolor="{fontcolor}", width={w}, height={h}, '
                f'tooltip="{tooltip}"')

    # Emit directory subgraphs (only when >1 directory)
    if len(dir_nodes) > 1:
        for i, (folder, graph_nodes) in enumerate(sorted(dir_nodes.items())):
            safe_label = folder.replace('"', '\\"')
            lines.append(f'  subgraph cluster_{i} {{')
            lines.append(f'    label="{safe_label}";')
            lines.append(f'    style=dashed; color="#94a3b8"; fontname="Inter"; fontsize=9;')
            for n in graph_nodes:
                nid = n["data"]["id"]
                lines.append(f'    "{nid}" [{_node_attrs(n)}];')
            lines.append('  }')
            lines.append('')
    else:
        for n in result["nodes"]:
            nid = n["data"]["id"]
            lines.append(f'  "{nid}" [{_node_attrs(n)}];')

    # Edges
    for e in result["edges"]:
        src = e["data"]["source"]
        tgt = e["data"]["target"]
        is_cycle = "classes" in e and "cycle" in e.get("classes", "")
        if is_cycle:
            lines.append(f'  "{src}" -> "{tgt}" [color="#ef4444", penwidth=2, style=bold];')
        else:
            color = e["data"].get("color", "#64748b")
            lines.append(f'  "{src}" -> "{tgt}" [color="{color}"];')

    # Legend
    lines.append('')
    lines.append('  subgraph cluster_legend {')
    if color_by == "directory":
        dir_colors = {}
        for n in result["nodes"]:
            nid = n["data"]["id"]
            parts = nid.rsplit("/", 1)
            folder = parts[0] if len(parts) > 1 else "."
            if folder not in dir_colors:
                dir_colors[folder] = n["data"].get("dir_color", n["data"].get("color", "#e2e8f0"))
        lines.append('    label="Directories"; style=solid; color="#334155"; fontname="Inter"; fontsize=10;')
        lines.append('    node [shape=plaintext, style=""];')
        legend_parts = []
        for folder in sorted(dir_colors):
            c = dir_colors[folder]
            legend_parts.append(f'<TR><TD BGCOLOR="{c}" WIDTH="12" HEIGHT="12"> </TD><TD ALIGN="LEFT"> {folder}</TD></TR>')
        html = '<TABLE BORDER="0" CELLSPACING="2">' + ''.join(legend_parts) + '</TABLE>'
        lines.append(f'    legend [label=<{html}>];')
    else:
        risks_used = {n["data"].get("risk", "normal") for n in result["nodes"]}
        lines.append('    label="Risk level"; style=solid; color="#334155"; fontname="Inter"; fontsize=10;')
        lines.append('    node [shape=plaintext, style=""];')
        legend_parts = []
        for risk in ["critical", "high", "warning", "normal", "entry", "system"]:
            if risk in risks_used:
                c = RISK_COLORS[risk]
                label = RISK_LABELS[risk]
                legend_parts.append(f'<TR><TD BGCOLOR="{c}" WIDTH="12" HEIGHT="12"> </TD><TD ALIGN="LEFT"> {label}</TD></TR>')
        html = '<TABLE BORDER="0" CELLSPACING="2">' + ''.join(legend_parts) + '</TABLE>'
        lines.append(f'    legend [label=<{html}>];')
    lines.append('  }')

    lines.append("}")
    return "\n".join(lines)


def _format_diff(old_result, new_result):
    """Return a Markdown-formatted dependency diff between two graph results."""
    old_nodes = {n["data"]["id"] for n in old_result["nodes"]}
    new_nodes = {n["data"]["id"] for n in new_result["nodes"]}

    old_edges = {(e["data"]["source"], e["data"]["target"])
                 for e in old_result["edges"]}
    new_edges = {(e["data"]["source"], e["data"]["target"])
                 for e in new_result["edges"]}

    added_nodes = sorted(new_nodes - old_nodes)
    removed_nodes = sorted(old_nodes - new_nodes)
    added_edges = sorted(new_edges - old_edges)
    removed_edges = sorted(old_edges - new_edges)

    # Detect new cycles
    old_cycle_groups = old_result.get("cycles", [])
    new_cycle_groups = new_result.get("cycles", [])
    old_cycle_sets = {frozenset(c) for c in old_cycle_groups if len(c) > 1}
    new_cycle_sets = {frozenset(c) for c in new_cycle_groups if len(c) > 1}
    new_cycles = new_cycle_sets - old_cycle_sets

    lines = []
    lines.append("## DepGraph — Dependency Diff")
    lines.append("")

    total_changes = len(added_nodes) + len(removed_nodes) + len(added_edges) + len(removed_edges)
    if total_changes == 0 and not new_cycles:
        lines.append("No dependency changes detected.")
        return "\n".join(lines)

    # Summary line
    parts = []
    if added_nodes:
        parts.append(f"+{len(added_nodes)} file{'s' if len(added_nodes) != 1 else ''}")
    if removed_nodes:
        parts.append(f"-{len(removed_nodes)} file{'s' if len(removed_nodes) != 1 else ''}")
    if added_edges:
        parts.append(f"+{len(added_edges)} dep{'s' if len(added_edges) != 1 else ''}")
    if removed_edges:
        parts.append(f"-{len(removed_edges)} dep{'s' if len(removed_edges) != 1 else ''}")
    lines.append(f"**{', '.join(parts)}**")
    lines.append("")

    if added_nodes:
        lines.append("<details>")
        lines.append(f"<summary>Added files ({len(added_nodes)})</summary>")
        lines.append("")
        for n in added_nodes:
            lines.append(f"- `{n}`")
        lines.append("")
        lines.append("</details>")
        lines.append("")

    if removed_nodes:
        lines.append("<details>")
        lines.append(f"<summary>Removed files ({len(removed_nodes)})</summary>")
        lines.append("")
        for n in removed_nodes:
            lines.append(f"- `{n}`")
        lines.append("")
        lines.append("</details>")
        lines.append("")

    if added_edges:
        lines.append("<details>")
        lines.append(f"<summary>Added dependencies ({len(added_edges)})</summary>")
        lines.append("")
        for src, tgt in added_edges:
            lines.append(f"- `{src}` → `{tgt}`")
        lines.append("")
        lines.append("</details>")
        lines.append("")

    if removed_edges:
        lines.append("<details>")
        lines.append(f"<summary>Removed dependencies ({len(removed_edges)})</summary>")
        lines.append("")
        for src, tgt in removed_edges:
            lines.append(f"- `{src}` → `{tgt}`")
        lines.append("")
        lines.append("</details>")
        lines.append("")

    if new_cycles:
        lines.append(f"⚠️ **{len(new_cycles)} new circular dependency group{'s' if len(new_cycles) != 1 else ''} introduced**")
        lines.append("")
        for cycle in sorted(new_cycles, key=len):
            cycle_files = " → ".join(f"`{f}`" for f in sorted(cycle))
            lines.append(f"- {cycle_files}")
        lines.append("")

    return "\n".join(lines)


def _format_mermaid(result, color_by="risk"):
    """Return a Mermaid flowchart.

    *color_by* controls the colour scheme (``"risk"`` or ``"directory"``).
    """
    from graph import RISK_COLORS, RISK_LABELS

    lines = ["graph LR"]

    # Sanitise IDs for Mermaid (replace slashes, dots, hyphens)
    def _mid(s):
        return s.replace("/", "_").replace(".", "_").replace("-", "_")

    # Group nodes by directory for subgraph support
    dir_nodes = {}
    for n in result["nodes"]:
        nid = n["data"]["id"]
        parts = nid.rsplit("/", 1)
        folder = parts[0] if len(parts) > 1 else "(root)"
        dir_nodes.setdefault(folder, []).append(n)

    cycle_nodes = set()
    for scc in result.get("cycles", []):
        if len(scc) > 1:
            cycle_nodes.update(scc)

    # Emit nodes grouped into subgraphs when >1 directory
    if len(dir_nodes) > 1:
        for folder, folder_nodes in sorted(dir_nodes.items()):
            safe_folder = folder.replace('"', "'")
            lines.append(f'  subgraph {_mid(folder)}["{safe_folder}"]')
            for n in folder_nodes:
                nid = n["data"]["id"]
                mid = _mid(nid)
                if nid in cycle_nodes:
                    lines.append(f'    {mid}["{nid} ⟳"]')
                else:
                    lines.append(f'    {mid}["{nid}"]')
            lines.append("  end")
    else:
        for n in result["nodes"]:
            nid = n["data"]["id"]
            mid = _mid(nid)
            if nid in cycle_nodes:
                lines.append(f'  {mid}["{nid} ⟳"]')
            else:
                lines.append(f'  {mid}["{nid}"]')

    # Edges
    for e in result["edges"]:
        src = _mid(e["data"]["source"])
        tgt = _mid(e["data"]["target"])
        is_cycle = "classes" in e and "cycle" in e.get("classes", "")
        if is_cycle:
            lines.append(f"  {src} -.->|cycle| {tgt}")
        else:
            lines.append(f"  {src} --> {tgt}")

    # Style definitions
    lines.append("")
    if color_by == "directory":
        dir_classes = {}
        dir_colors = {}
        for n in result["nodes"]:
            nid = n["data"]["id"]
            parts = nid.rsplit("/", 1)
            folder = parts[0] if len(parts) > 1 else "root"
            safe_folder = folder.replace("/", "_").replace(".", "_").replace("-", "_")
            dir_classes.setdefault(safe_folder, []).append(_mid(nid))
            if safe_folder not in dir_colors:
                dir_colors[safe_folder] = n["data"].get("dir_color", n["data"].get("color", "#e2e8f0"))
        for key, mids in sorted(dir_classes.items()):
            color = dir_colors[key]
            lines.append(f"  classDef dir_{key} fill:{color},stroke:#475569,color:#1e293b")
            lines.append(f"  class {','.join(mids)} dir_{key}")
        # Cycle nodes override
        if cycle_nodes:
            cycle_mids = [_mid(nid) for nid in cycle_nodes]
            lines.append("  classDef cycleNode fill:#fee2e2,stroke:#ef4444,stroke-width:2px,color:#991b1b")
            lines.append(f"  class {','.join(cycle_mids)} cycleNode")
    else:
        # Risk-based colouring
        risk_classes = {}
        for n in result["nodes"]:
            risk = n["data"].get("risk", "normal")
            risk_classes.setdefault(risk, []).append(_mid(n["data"]["id"]))
        for risk in ["critical", "high", "warning", "normal", "entry", "system"]:
            mids = risk_classes.get(risk)
            if mids:
                c = RISK_COLORS[risk]
                # critical gets white text, others dark
                fc = "#ffffff" if risk == "critical" else "#1e293b"
                sw = "2px" if risk == "critical" else "1px"
                lines.append(f"  classDef risk_{risk} fill:{c},stroke:#475569,stroke-width:{sw},color:{fc}")
                lines.append(f"  class {','.join(mids)} risk_{risk}")

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
                                 "java", "go", "rust", "cs", "csharp",
                                 "swift", "ruby", "kotlin", "scala",
                                 "php", "dart", "elixir"],
                        help="language mode (default: auto-detect)")

    # Output format (mutually exclusive)
    fmt = parser.add_mutually_exclusive_group()
    fmt.add_argument("--json", action="store_true", help="output JSON")
    fmt.add_argument("--dot", action="store_true", help="output Graphviz DOT")
    fmt.add_argument("--mermaid", action="store_true", help="output Mermaid diagram")
    fmt.add_argument("--serve", action="store_true",
                     help="start web UI and open browser")

    # Diff mode
    parser.add_argument("--diff", metavar="BASE_DIR",
                        help="compare dependencies against BASE_DIR and output a Markdown diff")

    # Filters
    parser.add_argument("--hide-external", action="store_true",
                        help="hide system / external imports")
    parser.add_argument("--hide-isolated", action="store_true",
                        help="hide files with no dependencies")
    parser.add_argument("--filter-dir", default="",
                        help="only show files under this subdirectory")

    # Colour mode
    parser.add_argument("--color-by", default="risk",
                        choices=["risk", "directory"],
                        help="color scheme: risk (default, by importance) or directory")

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

    # --diff: compare two directories and output Markdown diff
    if args.diff:
        base_dir = os.path.abspath(args.diff)
        if not os.path.isdir(base_dir):
            print(f"Error: '{args.diff}' is not a directory.", file=sys.stderr)
            sys.exit(1)

        detected_base = _detect_languages(base_dir)
        detected_head = _detect_languages(directory)

        # Merge detected languages from both dirs
        all_langs = set(detected_base.keys()) | set(detected_head.keys())
        merged = {k: detected_base.get(k, False) or detected_head.get(k, False)
                  for k in all_langs}

        base_flags = {
            "hide_system": args.hide_external,
            "show_c": merged.get("has_c", False),
            "show_h": merged.get("has_h", False),
            "show_cpp": merged.get("has_cpp", False),
            "show_js": merged.get("has_js", False),
            "show_py": merged.get("has_py", False),
            "show_java": merged.get("has_java", False),
            "show_go": merged.get("has_go", False),
            "show_rust": merged.get("has_rust", False),
            "show_cs": merged.get("has_cs", False),
            "show_swift": merged.get("has_swift", False),
            "show_ruby": merged.get("has_ruby", False),
            "show_kotlin": merged.get("has_kotlin", False),
            "show_scala": merged.get("has_scala", False),
            "show_php": merged.get("has_php", False),
            "show_dart": merged.get("has_dart", False),
            "show_elixir": merged.get("has_elixir", False),
            "hide_isolated": args.hide_isolated,
            "filter_dir": args.filter_dir,
        }

        base_result = _build_graph(base_dir, **base_flags)
        head_result = _build_graph(directory, **base_flags)

        output = _format_diff(base_result, head_result)

        if args.output:
            with open(args.output, "w") as f:
                f.write(output)
                f.write("\n")
            print(f"Written to {args.output}", file=sys.stderr)
        else:
            print(output)
        return

    # --serve: start the Flask web UI
    if args.serve:
        os.environ.setdefault("FLASK_DEBUG", "true")
        os.environ["DEPGRAPH_BASE_DIR"] = directory
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
        show_swift = detected.get("has_swift", False)
        show_ruby = detected.get("has_ruby", False)
        show_kotlin = detected.get("has_kotlin", False)
        show_scala = detected.get("has_scala", False)
        show_php = detected.get("has_php", False)
        show_dart = detected.get("has_dart", False)
        show_elixir = detected.get("has_elixir", False)
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
        show_swift = lang == "swift"
        show_ruby = lang == "ruby"
        show_kotlin = lang == "kotlin"
        show_scala = lang == "scala"
        show_php = lang == "php"
        show_dart = lang == "dart"
        show_elixir = lang == "elixir"

    # Build graph
    result = _build_graph(
        directory,
        hide_system=args.hide_external,
        show_c=show_c, show_h=show_h, show_cpp=show_cpp,
        show_js=show_js, show_py=show_py, show_java=show_java,
        show_go=show_go, show_rust=show_rust, show_cs=show_cs,
        show_swift=show_swift, show_ruby=show_ruby,
        show_kotlin=show_kotlin, show_scala=show_scala,
        show_php=show_php, show_dart=show_dart, show_elixir=show_elixir,
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
    color_by = args.color_by
    if args.json:
        output = _format_json(result)
    elif args.dot:
        output = _format_dot(result, color_by=color_by)
    elif args.mermaid:
        output = _format_mermaid(result, color_by=color_by)
    else:
        # Default: terminal tree (always uses risk colours)
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
