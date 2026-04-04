"""Core graph-building engine for DepGraph.

Scans source files, resolves imports using the language-specific parsers from
``parsers.py``, detects cycles (Tarjan's SCC), and computes per-node metrics
(depth, impact, stability, coupling).

This module uses only the Python standard library (plus ``parsers``) so it can
be imported by the CLI without Flask.
"""

import os
import hashlib

from parsers import (
    # Regex patterns
    INCLUDE_RE, JS_IMPORT_RE,
    PY_FROM_IMPORT_RE, PY_IMPORT_RE,
    JAVA_IMPORT_RE,
    GO_IMPORT_RE, GO_IMPORT_PATH_RE,
    RUST_USE_RE, RUST_MOD_RE, RUST_EXTERN_RE,
    CS_USING_RE,
    SWIFT_IMPORT_RE,
    RUBY_REQUIRE_RE, RUBY_REQUIRE_RELATIVE_RE,
    # Extension tuples
    C_EXTENSIONS, H_EXTENSIONS, CPP_EXTENSIONS, JS_EXTENSIONS,
    PY_EXTENSIONS, JAVA_EXTENSIONS, GO_EXTENSIONS, RUST_EXTENSIONS,
    CS_EXTENSIONS, SWIFT_EXTENSIONS, RUBY_EXTENSIONS,
    # Helpers
    collapse_py_multiline_imports,
    # Resolution functions
    resolve_js_import, resolve_py_import, resolve_java_import,
    parse_go_mod, resolve_go_import,
    resolve_rust_mod,
    build_cs_namespace_map, resolve_cs_using,
    resolve_swift_import,
    resolve_ruby_require,
    # Resolution cache
    ResolutionCache,
)


# =========================================================================
# Palette & colouring
# =========================================================================

_PALETTE = [
    "#6366f1", "#818cf8", "#8b5cf6", "#7c3aed", "#6d28d9",
    "#3b82f6", "#60a5fa", "#0ea5e9", "#06b6d4", "#14b8a6",
    "#0d9488", "#475569", "#64748b", "#7dd3fc", "#a78bfa",
    "#38bdf8", "#2dd4bf", "#a5b4fc", "#94a3b8", "#5eead4",
]


def _color_for_path(filepath):
    """Return a deterministic color based on the file's directory."""
    dirname = os.path.dirname(filepath) or "."
    hash_val = int(hashlib.md5(dirname.encode('utf-8')).hexdigest(), 16)
    return _PALETTE[hash_val % len(_PALETTE)]


# =========================================================================
# File filtering helpers
# =========================================================================

def _should_skip_dir(name):
    """Return True for directories that should be excluded from scanning."""
    lower = name.lower()
    return lower.startswith('test') or 'test' in lower or 'cmake' in lower


def _should_skip_file(name):
    """Return True for files that should be excluded from scanning."""
    lower = name.lower()
    return 'test' in lower or 'cmake' in lower


def _wanted_extension(filename, show_c, show_h, show_cpp, show_js=False,
                      show_py=False, show_java=False, show_go=False,
                      show_rust=False, show_cs=False, show_swift=False,
                      show_ruby=False):
    """Check whether a filename has an extension we want to include."""
    if filename.endswith(C_EXTENSIONS) and show_c:
        return True
    if filename.endswith(H_EXTENSIONS) and show_h:
        return True
    if filename.endswith(CPP_EXTENSIONS) and show_cpp:
        return True
    if filename.endswith(JS_EXTENSIONS) and show_js:
        return True
    if filename.endswith(PY_EXTENSIONS) and show_py:
        return True
    if filename.endswith(JAVA_EXTENSIONS) and show_java:
        return True
    if filename.endswith(GO_EXTENSIONS) and show_go:
        return True
    if filename.endswith(RUST_EXTENSIONS) and show_rust:
        return True
    if filename.endswith(CS_EXTENSIONS) and show_cs:
        return True
    if filename.endswith(SWIFT_EXTENSIONS) and show_swift:
        return True
    if filename.endswith(RUBY_EXTENSIONS) and show_ruby:
        return True
    return False


def _include_target_excluded(filename, show_c, show_h, show_cpp, show_js=False,
                             show_py=False, show_java=False, show_go=False,
                             show_rust=False, show_cs=False, show_swift=False,
                             show_ruby=False):
    """Return True if an include/import target should be excluded."""
    if filename.endswith(C_EXTENSIONS) and not show_c:
        return True
    if filename.endswith(H_EXTENSIONS) and not show_h:
        return True
    if filename.endswith(CPP_EXTENSIONS) and not show_cpp:
        return True
    if filename.endswith(JS_EXTENSIONS) and not show_js:
        return True
    if filename.endswith(PY_EXTENSIONS) and not show_py:
        return True
    if filename.endswith(JAVA_EXTENSIONS) and not show_java:
        return True
    if filename.endswith(GO_EXTENSIONS) and not show_go:
        return True
    if filename.endswith(RUST_EXTENSIONS) and not show_rust:
        return True
    if filename.endswith(CS_EXTENSIONS) and not show_cs:
        return True
    if filename.endswith(SWIFT_EXTENSIONS) and not show_swift:
        return True
    if filename.endswith(RUBY_EXTENSIONS) and not show_ruby:
        return True
    return False


# =========================================================================
# Tarjan's strongly-connected-components algorithm
# =========================================================================

def find_sccs(adj):
    """Compute SCCs using an iterative version of Tarjan's algorithm.

    The classic recursive formulation hits Python's default recursion limit
    on graphs with long chains (>1 000 nodes).  This iterative version uses
    an explicit call stack to avoid that.

    Parameters
    ----------
    adj : dict[str, list[str]]
        Adjacency list mapping each node to its successors.

    Returns
    -------
    list[list[str]]
        Each inner list is one strongly connected component.
    """
    index_counter = 0
    stack = []
    indices = {}
    lowlinks = {}
    on_stack = set()
    sccs = []

    for root in adj:
        if root in indices:
            continue
        # Each frame: (node, iterator_over_successors, phase)
        # phase=False means we haven't initialised this node yet.
        call_stack = [(root, iter(adj.get(root, [])), False)]
        while call_stack:
            v, children, initialised = call_stack[-1]
            if not initialised:
                indices[v] = index_counter
                lowlinks[v] = index_counter
                index_counter += 1
                stack.append(v)
                on_stack.add(v)
                call_stack[-1] = (v, children, True)
            # Advance to the next child
            recurse = False
            for w in children:
                if w not in indices:
                    call_stack.append((w, iter(adj.get(w, [])), False))
                    recurse = True
                    break
                elif w in on_stack:
                    lowlinks[v] = min(lowlinks[v], indices[w])
            if recurse:
                continue
            # All children processed — equivalent to returning from strongconnect
            if lowlinks[v] == indices[v]:
                scc = []
                while True:
                    w = stack.pop()
                    on_stack.remove(w)
                    scc.append(w)
                    if w == v:
                        break
                sccs.append(scc)
            call_stack.pop()
            if call_stack:
                parent = call_stack[-1][0]
                lowlinks[parent] = min(lowlinks[parent], lowlinks[v])

    return sccs


# =========================================================================
# Source file collection
# =========================================================================

def collect_source_files(directory, show_c, show_h, show_cpp, show_js=False,
                         show_py=False, show_java=False, show_go=False,
                         show_rust=False, show_cs=False, show_swift=False,
                         show_ruby=False):
    """Walk *directory* and return a list of source file paths to parse."""
    skip_dirs = set()
    if show_js:
        skip_dirs.add('node_modules')
    if show_py:
        skip_dirs.update({'__pycache__', '.venv', 'venv', '.tox', '.eggs',
                          '*.egg-info'})
    if show_go:
        skip_dirs.add('vendor')
    if show_rust:
        skip_dirs.add('target')
    if show_cs:
        skip_dirs.update({'bin', 'obj', 'packages', '.vs'})
    if show_ruby:
        skip_dirs.update({'vendor', '.bundle'})

    result = []
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not _should_skip_dir(d)
                   and d not in skip_dirs]
        for fname in files:
            if _should_skip_file(fname):
                continue
            if _wanted_extension(fname, show_c, show_h, show_cpp, show_js,
                                 show_py, show_java, show_go, show_rust,
                                 show_cs, show_swift, show_ruby):
                result.append(os.path.join(root, fname))
    return result


# =========================================================================
# Main graph builder
# =========================================================================

def build_graph(directory, hide_system=False, show_c=True, show_h=True,
                show_cpp=True, show_js=False, show_py=False,
                show_java=False, show_go=False, show_rust=False,
                show_cs=False, show_swift=False, show_ruby=False,
                hide_isolated=False, filter_dir=""):
    """Parse source files and return the dependency graph as a dict.

    Returns a dict with keys ``nodes``, ``edges``, ``has_cycles``, ``cycles``,
    ``unused_files``, ``coupling``, and ``depth_warnings``.
    """
    nodes = []
    edges = []
    node_set = set()

    files_to_parse = collect_source_files(
        directory, show_c, show_h, show_cpp, show_js,
        show_py, show_java, show_go, show_rust, show_cs,
        show_swift, show_ruby,
    )

    # Build a set of known relative paths for import resolution
    known_files = {os.path.relpath(fp, directory) for fp in files_to_parse}

    # Pre-read go.mod if Go is enabled
    go_module_path = parse_go_mod(directory) if show_go else None

    # Pre-scan C# namespace declarations for accurate resolution
    cs_ns_map, cs_class_map = (
        build_cs_namespace_map(directory, known_files) if show_cs else ({}, {})
    )

    # Per-build resolution cache — avoids re-resolving the same import string
    # thousands of times across different source files.
    _cache = ResolutionCache()

    def _add_edge(source, target):
        edges.append({
            "data": {
                "source": source,
                "target": target,
                "color": "#94a3b8",
            }
        })
        if target not in node_set:
            nodes.append({"data": {"id": target, "color": _color_for_path(target)}})
            node_set.add(target)

    for filepath in files_to_parse:
        filename = os.path.relpath(filepath, directory)

        if filename not in node_set:
            nodes.append({"data": {"id": filename, "color": _color_for_path(filename)}})
            node_set.add(filename)

        is_js_file = filepath.endswith(JS_EXTENSIONS)
        is_py_file = filepath.endswith(PY_EXTENSIONS)
        is_java_file = filepath.endswith(JAVA_EXTENSIONS)
        is_go_file = filepath.endswith(GO_EXTENSIONS)
        is_rust_file = filepath.endswith(RUST_EXTENSIONS)
        is_cs_file = filepath.endswith(CS_EXTENSIONS)
        is_swift_file = filepath.endswith(SWIFT_EXTENSIONS)
        is_ruby_file = filepath.endswith(RUBY_EXTENSIONS)

        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()

        # --- Python imports ---
        if is_py_file:
            content = collapse_py_multiline_imports(content)
            for m in PY_FROM_IMPORT_RE.finditer(content):
                from_path = m.group(1)
                names = m.group(2)
                if from_path and not from_path.replace('.', ''):
                    for name in names.split(','):
                        name = name.strip()
                        if not name or name == '*':
                            continue
                        mod = from_path + name
                        cached = _cache.get('py', mod, filename)
                        if cached is None:
                            cached = resolve_py_import(
                                mod, filename, directory, known_files
                            )
                            _cache.put('py', mod, filename, cached)
                        resolved, is_external = cached
                        if hide_system and is_external:
                            continue
                        _add_edge(filename, resolved)
                else:
                    cached = _cache.get('py', from_path, filename)
                    if cached is None:
                        cached = resolve_py_import(
                            from_path, filename, directory, known_files
                        )
                        _cache.put('py', from_path, filename, cached)
                    resolved, is_external = cached
                    if hide_system and is_external:
                        continue
                    _add_edge(filename, resolved)
            for m in PY_IMPORT_RE.finditer(content):
                for mod in m.group(1).split(','):
                    mod = mod.strip()
                    if not mod:
                        continue
                    cached = _cache.get('py', mod, filename)
                    if cached is None:
                        cached = resolve_py_import(
                            mod, filename, directory, known_files
                        )
                        _cache.put('py', mod, filename, cached)
                    resolved, is_external = cached
                    if hide_system and is_external:
                        continue
                    _add_edge(filename, resolved)
            continue

        # --- Java imports ---
        if is_java_file:
            for m in JAVA_IMPORT_RE.finditer(content):
                import_path = m.group(1)
                cached = _cache.get('java', import_path)
                if cached is None:
                    cached = resolve_java_import(
                        import_path, directory, known_files
                    )
                    _cache.put('java', import_path, None, cached)
                for resolved, is_external in cached:
                    if hide_system and is_external:
                        continue
                    _add_edge(filename, resolved)
            continue

        # --- Go imports ---
        if is_go_file:
            for m in GO_IMPORT_RE.finditer(content):
                if m.group(1) is not None:
                    for pm in GO_IMPORT_PATH_RE.finditer(m.group(1)):
                        imp = pm.group(1)
                        cached = _cache.get('go', imp)
                        if cached is None:
                            cached = resolve_go_import(
                                imp, directory, known_files, go_module_path
                            )
                            _cache.put('go', imp, None, cached)
                        resolved, is_external = cached
                        if hide_system and is_external:
                            continue
                        _add_edge(filename, resolved)
                else:
                    imp = m.group(2)
                    cached = _cache.get('go', imp)
                    if cached is None:
                        cached = resolve_go_import(
                            imp, directory, known_files, go_module_path
                        )
                        _cache.put('go', imp, None, cached)
                    resolved, is_external = cached
                    if hide_system and is_external:
                        continue
                    _add_edge(filename, resolved)
            continue

        # --- Rust imports ---
        if is_rust_file:
            for m in RUST_MOD_RE.finditer(content):
                mod_name = m.group(1)
                cached = _cache.get('rust_mod', mod_name, filename)
                if cached is None:
                    cached = resolve_rust_mod(
                        mod_name, filename, directory, known_files
                    )
                    _cache.put('rust_mod', mod_name, filename, cached)
                resolved, is_external = cached
                _add_edge(filename, resolved)
            for m in RUST_USE_RE.finditer(content):
                use_path = m.group(1).rstrip(':')
                top_crate = use_path.split('::')[0]
                if top_crate in ('crate', 'self', 'super'):
                    parts = [p for p in use_path.split('::') if p]
                    if parts[0] == 'crate':
                        parts = parts[1:]
                    elif parts[0] == 'self':
                        self_dir = os.path.dirname(filename)
                        parts = [self_dir] + parts[1:] if self_dir else parts[1:]
                    elif parts[0] == 'super':
                        super_count = 0
                        for p in parts:
                            if p == 'super':
                                super_count += 1
                            else:
                                break
                        base = filename
                        for _ in range(super_count + 1):
                            base = os.path.dirname(base)
                        parts = ([base] if base else []) + parts[super_count:]
                    parts = [p for p in parts if p]
                    if parts:
                        candidate = os.path.join(*parts) + '.rs'
                        if candidate in known_files:
                            _add_edge(filename, candidate)
                            continue
                        candidate = os.path.join(*parts, 'mod.rs')
                        if candidate in known_files:
                            _add_edge(filename, candidate)
                            continue
                else:
                    if hide_system:
                        continue
                    _add_edge(filename, top_crate)
            for m in RUST_EXTERN_RE.finditer(content):
                crate_name = m.group(1)
                if hide_system:
                    continue
                _add_edge(filename, crate_name)
            continue

        # --- C# using directives ---
        if is_cs_file:
            for m in CS_USING_RE.finditer(content):
                namespace = m.group(1)
                cached = _cache.get('cs', namespace)
                if cached is None:
                    cached = resolve_cs_using(
                        namespace, directory, known_files,
                        ns_map=cs_ns_map, class_map=cs_class_map
                    )
                    _cache.put('cs', namespace, None, cached)
                resolved_list, is_external = cached
                if hide_system and is_external:
                    continue
                for resolved in resolved_list:
                    if resolved != filename:
                        _add_edge(filename, resolved)
            continue

        # --- Swift imports ---
        if is_swift_file:
            for m in SWIFT_IMPORT_RE.finditer(content):
                module_name = m.group(1)
                cached = _cache.get('swift', module_name, filename)
                if cached is None:
                    cached = resolve_swift_import(
                        module_name, filename, directory, known_files
                    )
                    _cache.put('swift', module_name, filename, cached)
                resolved, is_external = cached
                if hide_system and is_external:
                    continue
                _add_edge(filename, resolved)
            continue

        # --- Ruby requires ---
        if is_ruby_file:
            for m in RUBY_REQUIRE_RELATIVE_RE.finditer(content):
                req_path = m.group(1)
                cached = _cache.get('ruby_rel', req_path, filename)
                if cached is None:
                    cached = resolve_ruby_require(
                        req_path, filename, directory, known_files, relative=True
                    )
                    _cache.put('ruby_rel', req_path, filename, cached)
                resolved, is_external = cached
                if hide_system and is_external:
                    continue
                _add_edge(filename, resolved)
            for m in RUBY_REQUIRE_RE.finditer(content):
                req_path = m.group(1)
                line_text = content[max(0, content.rfind('\n', 0, m.start())+1):m.end()]
                if 'require_relative' in line_text:
                    continue
                cached = _cache.get('ruby', req_path)
                if cached is None:
                    cached = resolve_ruby_require(
                        req_path, filename, directory, known_files, relative=False
                    )
                    _cache.put('ruby', req_path, None, cached)
                resolved, is_external = cached
                if hide_system and is_external:
                    continue
                _add_edge(filename, resolved)
            continue

        # --- C / C++ and JS/TS (line-by-line) ---
        for line in content.splitlines():
            if not is_js_file:
                match = INCLUDE_RE.search(line)
                if not match:
                    continue

                is_system = match.group(1) == '<'
                if hide_system and is_system:
                    continue

                included = match.group(2)
                if _include_target_excluded(included, show_c, show_h, show_cpp,
                                            show_js, show_py, show_java,
                                            show_go, show_rust, show_cs,
                                            show_swift, show_ruby):
                    continue

                _add_edge(filename, included)

            else:
                match = JS_IMPORT_RE.search(line)
                if not match:
                    continue

                raw_path = match.group(1) or match.group(2)
                cached = _cache.get('js', raw_path, filename)
                if cached is None:
                    cached = resolve_js_import(
                        raw_path, filename, directory, known_files
                    )
                    _cache.put('js', raw_path, filename, cached)
                resolved, is_external = cached

                if hide_system and is_external:
                    continue

                _add_edge(filename, resolved)

    # --- Cycle detection via SCCs ---
    adj = {node["data"]["id"]: [] for node in nodes}
    for edge in edges:
        adj.setdefault(edge["data"]["source"], []).append(edge["data"]["target"])

    sccs = find_sccs(adj)

    cycle_nodes = set()
    cycles_list = []
    for scc in sccs:
        if len(scc) > 1:
            cycle_nodes.update(scc)
            cycles_list.append(scc)

    scc_lookup = {}
    for scc in sccs:
        if len(scc) > 1:
            for node_id in scc:
                scc_lookup[node_id] = scc

    has_cycle_edges = False
    for edge in edges:
        u = edge["data"]["source"]
        v = edge["data"]["target"]
        if u == v:
            edge["classes"] = "cycle"
            has_cycle_edges = True
            if [u] not in cycles_list:
                cycles_list.append([u])
        elif u in scc_lookup and v in scc_lookup and scc_lookup[u] is scc_lookup[v]:
            edge["classes"] = "cycle"
            has_cycle_edges = True

    # --- Compute in-degrees for node sizing ---
    in_degrees = {node["data"]["id"]: 0 for node in nodes}
    for edge in edges:
        target = edge["data"]["target"]
        if target in in_degrees:
            in_degrees[target] += 1

    for node in nodes:
        node["data"]["size"] = 80 + in_degrees[node["data"]["id"]] * 40

    # --- Compute out-degrees ---
    out_degrees = {node["data"]["id"]: 0 for node in nodes}
    for edge in edges:
        src = edge["data"]["source"]
        if src in out_degrees:
            out_degrees[src] += 1

    # --- Dependency depth (longest transitive dependency chain) ---
    # Iterative post-order DFS avoids hitting Python's recursion limit on
    # large graphs.  Each stack frame is (node_id, child_index, max_so_far).
    dep_depth = {}
    for start in adj:
        if start in dep_depth:
            continue
        dfs_stack = [(start, 0, 0)]
        visiting = {start}
        while dfs_stack:
            node_id, child_idx, max_so_far = dfs_stack[-1]
            children = adj.get(node_id, [])
            advanced = False
            while child_idx < len(children):
                w = children[child_idx]
                child_idx += 1
                if w in visiting:
                    continue  # cycle — skip
                if w in dep_depth:
                    max_so_far = max(max_so_far, 1 + dep_depth[w])
                else:
                    # Save progress and recurse into w
                    dfs_stack[-1] = (node_id, child_idx, max_so_far)
                    dfs_stack.append((w, 0, 0))
                    visiting.add(w)
                    advanced = True
                    break
            if not advanced:
                # All children processed
                dep_depth[node_id] = max_so_far
                visiting.discard(node_id)
                dfs_stack.pop()
                if dfs_stack:
                    pn, pi, pm = dfs_stack[-1]
                    dfs_stack[-1] = (pn, pi, max(pm, 1 + max_so_far))

    for node in nodes:
        node["data"]["depth"] = dep_depth.get(node["data"]["id"], 0)

    # --- Impact analysis (downstream closure size) ---
    rev_adj = {node["data"]["id"]: [] for node in nodes}
    for edge in edges:
        rev_adj.setdefault(edge["data"]["target"], []).append(edge["data"]["source"])

    impact = {}
    def _downstream_closure(node_id):
        if node_id in impact:
            return impact[node_id]
        visited = set()
        stack = [node_id]
        while stack:
            cur = stack.pop()
            for dep in rev_adj.get(cur, []):
                if dep not in visited and dep != node_id:
                    visited.add(dep)
                    stack.append(dep)
        impact[node_id] = len(visited)
        return impact[node_id]

    for nid in rev_adj:
        _downstream_closure(nid)

    for node in nodes:
        node["data"]["impact"] = impact.get(node["data"]["id"], 0)

    # --- Stability metric: I = Ce / (Ca + Ce) ---
    for node in nodes:
        nid = node["data"]["id"]
        ca = in_degrees.get(nid, 0)   # afferent (inbound)
        ce = out_degrees.get(nid, 0)  # efferent (outbound)
        node["data"]["stability"] = round(ce / (ca + ce), 3) if (ca + ce) > 0 else 0.5

    # --- Unused file detection (zero inbound edges) ---
    unused_files = [nid for nid, deg in in_degrees.items() if deg == 0]

    # --- Coupling score between directories ---
    dir_edges = {}  # (dirA, dirB) → count
    dir_total = {}  # dir → total edges touching it
    for edge in edges:
        src_dir = os.path.dirname(edge["data"]["source"]) or "."
        tgt_dir = os.path.dirname(edge["data"]["target"]) or "."
        if src_dir != tgt_dir:
            pair = tuple(sorted([src_dir, tgt_dir]))
            dir_edges[pair] = dir_edges.get(pair, 0) + 1
        dir_total[src_dir] = dir_total.get(src_dir, 0) + 1
        dir_total[tgt_dir] = dir_total.get(tgt_dir, 0) + 1

    coupling_scores = []
    for (d1, d2), cross_count in sorted(dir_edges.items(),
                                         key=lambda x: x[1], reverse=True)[:20]:
        total = dir_total.get(d1, 0) + dir_total.get(d2, 0)
        score = round(cross_count / total, 3) if total > 0 else 0
        coupling_scores.append({
            "dir1": d1, "dir2": d2,
            "cross_edges": cross_count, "score": score,
        })

    # --- Optional filters ---
    if hide_isolated:
        connected = set()
        for edge in edges:
            connected.add(edge["data"]["source"])
            connected.add(edge["data"]["target"])
        nodes = [n for n in nodes if n["data"]["id"] in connected]

    if filter_dir:
        nodes = [n for n in nodes if n["data"]["id"].startswith(filter_dir)]
        valid_ids = {n["data"]["id"] for n in nodes}
        edges = [e for e in edges if e["data"]["source"] in valid_ids
                 and e["data"]["target"] in valid_ids]

    # --- Dependency depth warnings ---
    total_files = len(nodes) if nodes else 1
    depth_warnings = []
    for node in nodes:
        nd = node["data"]
        file_id = nd["id"]
        file_depth = nd.get("depth", 0)
        file_impact = nd.get("impact", 0)
        reach_pct = round(file_impact / total_files * 100, 1) if total_files > 0 else 0
        nd["reach_pct"] = reach_pct

        severity = None
        reasons = []

        if reach_pct >= 50:
            severity = "critical"
            reasons.append(f"pulls in {reach_pct}% of codebase")
        elif reach_pct >= 30:
            severity = "warning" if severity != "critical" else severity
            reasons.append(f"pulls in {reach_pct}% of codebase")

        if file_depth >= 8:
            severity = "critical"
            reasons.append(f"dependency chain {file_depth} levels deep")
        elif file_depth >= 5:
            if severity != "critical":
                severity = "warning"
            reasons.append(f"dependency chain {file_depth} levels deep")

        if severity:
            depth_warnings.append({
                "file": file_id,
                "severity": severity,
                "depth": file_depth,
                "impact": file_impact,
                "reach_pct": reach_pct,
                "reasons": reasons,
            })

    depth_warnings.sort(key=lambda w: (0 if w["severity"] == "critical" else 1, -w["reach_pct"]))

    return {
        "nodes": nodes,
        "edges": edges,
        "has_cycles": has_cycle_edges,
        "cycles": cycles_list,
        "unused_files": unused_files,
        "coupling": coupling_scores,
        "depth_warnings": depth_warnings,
    }


# =========================================================================
# Language detection
# =========================================================================

def detect_languages(directory):
    """Scan *directory* for source files and return which language groups exist."""
    flags = {
        "has_c": False, "has_h": False, "has_cpp": False, "has_js": False,
        "has_py": False, "has_java": False, "has_go": False, "has_rust": False,
        "has_cs": False, "has_swift": False, "has_ruby": False,
    }
    skip_dirs = {'node_modules', '__pycache__', '.venv', 'venv', 'target',
                 'vendor', 'bin', 'obj', 'packages', '.vs', '.bundle'}
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not _should_skip_dir(d) and d not in skip_dirs]
        for fname in files:
            if _should_skip_file(fname):
                continue
            if fname.endswith(C_EXTENSIONS):
                flags["has_c"] = True
            if fname.endswith(H_EXTENSIONS):
                flags["has_h"] = True
            if fname.endswith(CPP_EXTENSIONS):
                flags["has_cpp"] = True
            if fname.endswith(JS_EXTENSIONS):
                flags["has_js"] = True
            if fname.endswith(PY_EXTENSIONS):
                flags["has_py"] = True
            if fname.endswith(JAVA_EXTENSIONS):
                flags["has_java"] = True
            if fname.endswith(GO_EXTENSIONS):
                flags["has_go"] = True
            if fname.endswith(RUST_EXTENSIONS):
                flags["has_rust"] = True
            if fname.endswith(CS_EXTENSIONS):
                flags["has_cs"] = True
            if fname.endswith(SWIFT_EXTENSIONS):
                flags["has_swift"] = True
            if fname.endswith(RUBY_EXTENSIONS):
                flags["has_ruby"] = True
            if all(flags.values()):
                return flags
    return flags


def parse_filters(source, detected=None):
    """Extract filter flags from a request args or form dict.

    When *detected* is provided (a dict from ``detect_languages``), the
    ``mode=auto`` value will use the detected languages instead of enabling
    everything blindly.
    """
    mode = source.get('mode', '')

    if mode == 'auto' and detected:
        show_c = detected["has_c"]
        show_h = detected["has_h"]
        show_cpp = detected["has_cpp"]
        show_js = detected["has_js"]
        show_py = detected["has_py"]
        show_java = detected["has_java"]
        show_go = detected["has_go"]
        show_rust = detected["has_rust"]
        show_cs = detected["has_cs"]
        show_swift = detected["has_swift"]
        show_ruby = detected["has_ruby"]
    elif mode == 'auto':
        show_c = show_h = show_cpp = show_js = True
        show_py = show_java = show_go = show_rust = show_cs = True
        show_swift = show_ruby = True
    else:
        show_c = source.get('show_c', 'true').lower() == 'true'
        show_h = source.get('show_h', 'true').lower() == 'true'
        show_cpp = source.get('show_cpp', 'true').lower() == 'true'
        show_js = source.get('show_js', 'false').lower() == 'true'
        show_py = source.get('show_py', 'false').lower() == 'true'
        show_java = source.get('show_java', 'false').lower() == 'true'
        show_go = source.get('show_go', 'false').lower() == 'true'
        show_rust = source.get('show_rust', 'false').lower() == 'true'
        show_cs = source.get('show_cs', 'false').lower() == 'true'
        show_swift = source.get('show_swift', 'false').lower() == 'true'
        show_ruby = source.get('show_ruby', 'false').lower() == 'true'

    return {
        "hide_system": source.get('hide_system', 'false').lower() == 'true',
        "show_c": show_c,
        "show_h": show_h,
        "show_cpp": show_cpp,
        "show_js": show_js,
        "show_py": show_py,
        "show_java": show_java,
        "show_go": show_go,
        "show_rust": show_rust,
        "show_cs": show_cs,
        "show_swift": show_swift,
        "show_ruby": show_ruby,
        "hide_isolated": source.get('hide_isolated', 'false').lower() == 'true',
        "filter_dir": source.get('filter_dir', ''),
    }
