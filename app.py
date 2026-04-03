"""DepGraph — Flask server for visualizing source file dependencies."""

import os
import re
import hashlib
import tempfile
import zipfile
import shutil

from werkzeug.utils import secure_filename
from flask import Flask, jsonify, request

app = Flask(__name__, static_folder='static')

# Color palette for mapping directories to consistent node colors.
_PALETTE = [
    "#4E79A7", "#F28E2C", "#E15759", "#76B7B2", "#59A14F",
    "#EDC949", "#AF7AA1", "#FF9DA7", "#9C755F", "#BAB0AB",
    "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD",
    "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22", "#17BECF",
]

# --- Import / include patterns per language ---
_INCLUDE_RE = re.compile(r'#include\s*(<|")([^>"]+)(>|")')

# JS/TS: import ... from 'path', import 'path', require('path')
_JS_IMPORT_RE = re.compile(
    r'''(?:import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]'''
    r'''|require\s*\(\s*['"]([^'"]+)['"]\s*\))'''
)

# --- File extension groups ---
_C_EXTENSIONS = ('.c',)
_H_EXTENSIONS = ('.h',)
_CPP_EXTENSIONS = ('.cpp', '.cc', '.cxx', '.hpp', '.hxx')
_JS_EXTENSIONS = ('.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx')


def _color_for_path(filepath):
    """Return a deterministic color based on the file's directory."""
    dirname = os.path.dirname(filepath) or "."
    hash_val = int(hashlib.md5(dirname.encode('utf-8')).hexdigest(), 16)
    return _PALETTE[hash_val % len(_PALETTE)]


def _should_skip_dir(name):
    """Return True for directories that should be excluded from scanning."""
    lower = name.lower()
    return lower.startswith('test') or 'test' in lower or 'cmake' in lower


def _should_skip_file(name):
    """Return True for files that should be excluded from scanning."""
    lower = name.lower()
    return 'test' in lower or 'cmake' in lower


def _wanted_extension(filename, show_c, show_h, show_cpp, show_js=False):
    """Check whether a filename has an extension we want to include.

    Used when collecting source files to parse (strict matching).
    """
    if filename.endswith(_C_EXTENSIONS) and show_c:
        return True
    if filename.endswith(_H_EXTENSIONS) and show_h:
        return True
    if filename.endswith(_CPP_EXTENSIONS) and show_cpp:
        return True
    if filename.endswith(_JS_EXTENSIONS) and show_js:
        return True
    return False


def _include_target_excluded(filename, show_c, show_h, show_cpp, show_js=False):
    """Return True if an include/import target should be excluded.

    Unlike ``_wanted_extension``, this only rejects targets whose extension
    matches a *disabled* type.  Targets with unrecognized or no extension are
    allowed through so that extensionless C++ headers (e.g. ``<vector>``) and
    non-standard includes still appear in the graph.
    """
    if filename.endswith(_C_EXTENSIONS) and not show_c:
        return True
    if filename.endswith(_H_EXTENSIONS) and not show_h:
        return True
    if filename.endswith(_CPP_EXTENSIONS) and not show_cpp:
        return True
    if filename.endswith(_JS_EXTENSIONS) and not show_js:
        return True
    return False


# ---------------------------------------------------------------------------
# Tarjan's strongly-connected-components algorithm
# ---------------------------------------------------------------------------

def _find_sccs(adj):
    """Compute SCCs using Tarjan's algorithm.

    Parameters
    ----------
    adj : dict[str, list[str]]
        Adjacency list mapping each node to its successors.

    Returns
    -------
    list[list[str]]
        Each inner list is one strongly connected component.
    """
    index_counter = [0]
    stack = []
    indices = {}
    lowlinks = {}
    on_stack = set()
    sccs = []

    def strongconnect(v):
        indices[v] = index_counter[0]
        lowlinks[v] = index_counter[0]
        index_counter[0] += 1
        stack.append(v)
        on_stack.add(v)

        for w in adj.get(v, []):
            if w not in indices:
                strongconnect(w)
                lowlinks[v] = min(lowlinks[v], lowlinks[w])
            elif w in on_stack:
                lowlinks[v] = min(lowlinks[v], indices[w])

        if lowlinks[v] == indices[v]:
            scc = []
            while True:
                w = stack.pop()
                on_stack.remove(w)
                scc.append(w)
                if w == v:
                    break
            sccs.append(scc)

    for v in adj:
        if v not in indices:
            strongconnect(v)

    return sccs


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def _collect_source_files(directory, show_c, show_h, show_cpp, show_js=False):
    """Walk *directory* and return a list of source file paths to parse."""
    result = []
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not _should_skip_dir(d)]
        # Also skip node_modules for JS/TS projects
        if show_js:
            dirs[:] = [d for d in dirs if d != 'node_modules']
        for fname in files:
            if _should_skip_file(fname):
                continue
            if _wanted_extension(fname, show_c, show_h, show_cpp, show_js):
                result.append(os.path.join(root, fname))
    return result


def _resolve_js_import(import_path, source_file, directory, known_files):
    """Try to resolve a JS/TS import path to a real file in the project.

    Handles bare specifiers (treated as external / node_modules — skipped when
    hide_system is on), relative paths, and extensionless imports by probing
    common extensions.
    """
    if not import_path.startswith('.'):
        # Bare / absolute specifier — treat like a "system" import
        return import_path, True

    source_dir = os.path.dirname(source_file)
    candidate = os.path.normpath(os.path.join(source_dir, import_path))

    # If already has a known extension, use as-is
    if candidate in known_files:
        return candidate, False

    # Probe common extensions
    for ext in _JS_EXTENSIONS:
        probe = candidate + ext
        if probe in known_files:
            return probe, False

    # Probe index files (import './foo' → ./foo/index.js)
    for ext in _JS_EXTENSIONS:
        probe = os.path.join(candidate, 'index' + ext)
        if probe in known_files:
            return probe, False

    # Return the raw path — may create an "unresolved" node, which is fine
    return candidate, False


def _build_graph(directory, hide_system=False, show_c=True, show_h=True,
                 show_cpp=True, show_js=False, hide_isolated=False,
                 filter_dir=""):
    """Parse source files and return the dependency graph as a dict.

    Returns a dict with keys ``nodes``, ``edges``, ``has_cycles``, and
    ``cycles``.
    """
    nodes = []
    edges = []
    node_set = set()

    files_to_parse = _collect_source_files(directory, show_c, show_h, show_cpp, show_js)

    # Build a set of known relative paths for JS/TS resolution
    known_files = {os.path.relpath(fp, directory) for fp in files_to_parse}

    for filepath in files_to_parse:
        filename = os.path.relpath(filepath, directory)

        if filename not in node_set:
            nodes.append({"data": {"id": filename, "color": _color_for_path(filename)}})
            node_set.add(filename)

        is_js_file = filepath.endswith(_JS_EXTENSIONS)

        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                # --- C / C++ includes ---
                if not is_js_file:
                    match = _INCLUDE_RE.search(line)
                    if not match:
                        continue

                    is_system = match.group(1) == '<'
                    if hide_system and is_system:
                        continue

                    included = match.group(2)
                    if _include_target_excluded(included, show_c, show_h, show_cpp, show_js):
                        continue

                    edges.append({
                        "data": {
                            "source": filename,
                            "target": included,
                            "color": _color_for_path(filename),
                        }
                    })

                    if included not in node_set:
                        nodes.append({"data": {"id": included, "color": _color_for_path(included)}})
                        node_set.add(included)

                # --- JS / TS imports ---
                else:
                    match = _JS_IMPORT_RE.search(line)
                    if not match:
                        continue

                    raw_path = match.group(1) or match.group(2)
                    resolved, is_external = _resolve_js_import(
                        raw_path, filename, directory, known_files
                    )

                    if hide_system and is_external:
                        continue

                    edges.append({
                        "data": {
                            "source": filename,
                            "target": resolved,
                            "color": _color_for_path(filename),
                        }
                    })

                    if resolved not in node_set:
                        nodes.append({"data": {"id": resolved, "color": _color_for_path(resolved)}})
                        node_set.add(resolved)

    # --- Cycle detection via SCCs ---
    adj = {node["data"]["id"]: [] for node in nodes}
    for edge in edges:
        adj.setdefault(edge["data"]["source"], []).append(edge["data"]["target"])

    sccs = _find_sccs(adj)

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
        edges = [e for e in edges if e["data"]["source"] in valid_ids and e["data"]["target"] in valid_ids]

    return {
        "nodes": nodes,
        "edges": edges,
        "has_cycles": has_cycle_edges,
        "cycles": cycles_list,
    }


# ---------------------------------------------------------------------------
# Helper to pull filter params from a request
# ---------------------------------------------------------------------------

def _parse_filters(source):
    """Extract filter flags from a request args or form dict."""
    return {
        "hide_system": source.get('hide_system', 'false').lower() == 'true',
        "show_c": source.get('show_c', 'true').lower() == 'true',
        "show_h": source.get('show_h', 'true').lower() == 'true',
        "show_cpp": source.get('show_cpp', 'true').lower() == 'true',
        "show_js": source.get('show_js', 'false').lower() == 'true',
        "hide_isolated": source.get('hide_isolated', 'false').lower() == 'true',
        "filter_dir": source.get('filter_dir', ''),
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return app.send_static_file('index.html')


@app.route('/api/graph', methods=['GET'])
def get_graph():
    directory = request.args.get('dir', '.')

    if not os.path.isdir(directory):
        return jsonify({"error": f"Directory not found: {directory}"}), 400

    filters = _parse_filters(request.args)
    return jsonify(_build_graph(directory, **filters))


@app.route('/api/upload', methods=['POST'])
def upload_files():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    allowed_ext = ('.zip',) + _C_EXTENSIONS + _H_EXTENSIONS + _CPP_EXTENSIONS + _JS_EXTENSIONS
    if not file.filename.endswith(allowed_ext):
        return jsonify({"error": "Unsupported file type. Please upload a ZIP or supported source file."}), 400

    filters = _parse_filters(request.form)
    temp_dir = tempfile.mkdtemp()

    try:
        saved_path = os.path.join(temp_dir, secure_filename(file.filename))
        file.save(saved_path)

        if saved_path.endswith('.zip'):
            with zipfile.ZipFile(saved_path, 'r') as zf:
                zf.extractall(temp_dir)

        return jsonify(_build_graph(temp_dir, **filters))
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        shutil.rmtree(temp_dir)


if __name__ == '__main__':
    import os
    debug = os.environ.get('FLASK_DEBUG', 'true').lower() == 'true'
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', debug=debug, port=port)
