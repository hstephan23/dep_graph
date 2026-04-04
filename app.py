"""DepGraph — Flask server for visualizing source file dependencies.

The core graph-building logic lives in ``graph.py`` (which uses ``parsers.py``
for language-specific import resolution).  Both modules use only the Python
standard library so they can be imported by the CLI without Flask.
"""

import os
import tempfile
import zipfile
import shutil
import threading
import time
import secrets

from graph import (
    build_graph,
    detect_languages,
    parse_filters,
    find_sccs,
)

try:
    from werkzeug.utils import secure_filename
    from flask import Flask, jsonify, request, abort
    _HAS_FLASK = True
except ImportError:
    _HAS_FLASK = False

if _HAS_FLASK:
    app = Flask(__name__, static_folder='static')
else:
    # Provide a stub so @app.route() etc. don't crash at import time.
    # This allows cli.py to import the core graph logic without Flask.
    class _StubApp:
        config = {}
        def route(self, *a, **kw):
            return lambda f: f
        def before_request(self, f):
            return f
    app = _StubApp()

    def secure_filename(f):
        return f

    def jsonify(*a, **kw):
        pass

    def abort(code):
        pass

    class _StubRequest:
        args = {}
        method = 'GET'
        headers = {}
        form = {}
        files = {}
        content_length = 0
    request = _StubRequest()

# --- Security configuration ---

app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB upload limit

# CSRF token: use a stable secret from the environment so all workers share
# the same value.  Falls back to a random token (fine for single-worker).
_csrf_token = os.environ.get('CSRF_SECRET') or secrets.token_hex(32)

# Base directory that the server is allowed to scan. Set DEPGRAPH_BASE_DIR
# environment variable to restrict access; defaults to the parent of the
# current working directory so that sibling project directories (e.g.
# ../C/retro-gaming-project) remain accessible.
_ALLOWED_BASE_DIR = os.path.abspath(
    os.environ.get('DEPGRAPH_BASE_DIR', os.path.dirname(os.getcwd()))
)

# Simple rate-limiter: per-IP, max N requests in a sliding window
_RATE_LIMIT = int(os.environ.get('DEPGRAPH_RATE_LIMIT', '30'))  # requests
_RATE_WINDOW = int(os.environ.get('DEPGRAPH_RATE_WINDOW', '60'))  # seconds
_rate_store = {}  # ip -> list of timestamps
_rate_lock = threading.Lock()


def _rate_limit_check():
    """Return True if the request should be rate-limited (rejected)."""
    ip = request.remote_addr or 'unknown'
    now = time.time()
    with _rate_lock:
        timestamps = _rate_store.get(ip, [])
        timestamps = [t for t in timestamps if now - t < _RATE_WINDOW]
        if len(timestamps) >= _RATE_LIMIT:
            _rate_store[ip] = timestamps
            return True
        timestamps.append(now)
        _rate_store[ip] = timestamps
    return False


def _validate_directory(directory):
    """Validate that a directory path is within the allowed base directory.

    Returns the absolute path if valid, or None if invalid.
    """
    abs_dir = os.path.abspath(directory)
    # Ensure the path is within the allowed base
    if not (abs_dir == _ALLOWED_BASE_DIR
            or abs_dir.startswith(_ALLOWED_BASE_DIR + os.sep)):
        return None
    if not os.path.isdir(abs_dir):
        return None
    return abs_dir


@app.before_request
def _before_request():
    """Global rate limiting."""
    if _rate_limit_check():
        return jsonify({"error": "Rate limit exceeded. Try again later."}), 429


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return app.send_static_file('index.html')


def _get_json_body():
    """Parse request JSON, returning (body, None) on success or (None, error_response) on failure."""
    try:
        body = request.get_json(force=True)
        if body is None:
            return None, (jsonify({"error": "Invalid or empty JSON body."}), 400)
        return body, None
    except Exception:
        return None, (jsonify({"error": "Malformed JSON in request body."}), 400)


@app.route('/api/config')
def get_config():
    """Expose non-sensitive configuration flags to the frontend."""
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    return jsonify({"dev_mode": debug})


@app.route('/api/file', methods=['GET'])
def get_file():
    """Return the contents of a source file for preview.

    Query params:
    - dir: base directory the graph was built from (or upload_token for uploads)
    - path: relative file path within that directory
    """
    directory = request.args.get('dir', '.')
    upload_token = request.args.get('upload_token', '')
    filepath = request.args.get('path', '')

    if not filepath:
        return jsonify({"error": "No file path provided"}), 400

    # Determine the base directory: either from an upload token or a validated path
    if upload_token:
        abs_dir = _load_upload_session(upload_token)
        if not abs_dir:
            return jsonify({"error": "Upload session expired or invalid."}), 404
    else:
        abs_dir = _validate_directory(directory)
        if abs_dir is None:
            return jsonify({"error": "Directory not found or access denied."}), 403

    # Resolve to absolute path and enforce containment
    full_path = os.path.abspath(os.path.join(abs_dir, filepath))
    if not full_path.startswith(abs_dir + os.sep) and full_path != abs_dir:
        return jsonify({"error": "Invalid file path"}), 403

    # If the direct path doesn't exist, search for the filename within the
    # *validated* base directory only. This handles unresolved includes like
    # "game_state.h" that are stored as bare filenames in the graph.
    if not os.path.isfile(full_path):
        basename = os.path.basename(filepath)
        found = None
        for root, _dirs, files in os.walk(abs_dir):
            if basename in files:
                candidate = os.path.join(root, basename)
                # Double-check containment
                if candidate.startswith(abs_dir + os.sep):
                    found = candidate
                    break
        if found:
            full_path = found
            filepath = os.path.relpath(found, abs_dir)
        else:
            return jsonify({"error": "File not found."}), 404

    try:
        with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        ext = os.path.splitext(filepath)[1].lower()
        lang_map = {
            '.py': 'python', '.js': 'javascript', '.jsx': 'jsx',
            '.ts': 'typescript', '.tsx': 'tsx', '.mjs': 'javascript',
            '.cjs': 'javascript', '.c': 'c', '.h': 'c', '.cpp': 'cpp',
            '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
            '.java': 'java', '.go': 'go', '.rs': 'rust',
            '.swift': 'swift', '.rb': 'ruby',
        }
        return jsonify({
            "path": filepath,
            "content": content,
            "language": lang_map.get(ext, 'plaintext'),
            "lines": content.count('\n') + 1,
        })
    except Exception:
        return jsonify({"error": "Could not read file."}), 500


@app.route('/api/detect', methods=['GET'])
def detect_languages_route():
    """Scan a directory and return which language groups are present."""
    directory = request.args.get('dir', '.')

    abs_dir = _validate_directory(directory)
    if abs_dir is None:
        return jsonify({"error": "Directory not found or access denied."}), 400

    return jsonify(detect_languages(abs_dir))


@app.route('/api/graph', methods=['GET'])
def get_graph():
    directory = request.args.get('dir', '.')

    abs_dir = _validate_directory(directory)
    if abs_dir is None:
        return jsonify({"error": "Directory not found or access denied."}), 400

    detected = detect_languages(abs_dir)
    filters = parse_filters(request.args, detected=detected)
    result = build_graph(abs_dir, **filters)
    result["detected"] = detected
    return jsonify(result)


# ---------------------------------------------------------------------------
# Upload session management
# ---------------------------------------------------------------------------
# Upload sessions are persisted to disk so that all Gunicorn workers can
# resolve tokens.  Each upload creates a temp directory; a sibling marker
# file (<token>.session) in the shared session root maps the token back to
# the directory path.  Sessions expire after _UPLOAD_TTL seconds.

_UPLOAD_SESSION_ROOT = os.path.join(tempfile.gettempdir(), 'depgraph_sessions')
os.makedirs(_UPLOAD_SESSION_ROOT, exist_ok=True)

_UPLOAD_TTL = int(os.environ.get('DEPGRAPH_UPLOAD_TTL', '3600'))  # 1 hour
_upload_lock = threading.Lock()


def _session_file(token):
    """Return the path to the marker file for *token*."""
    # Sanitise token so it can't escape the directory
    safe = token.replace('/', '').replace('..', '').replace(os.sep, '')
    return os.path.join(_UPLOAD_SESSION_ROOT, safe + '.session')


def _save_upload_session(token, temp_dir):
    """Persist a token → temp_dir mapping to disk."""
    with open(_session_file(token), 'w') as f:
        f.write(temp_dir)


def _load_upload_session(token):
    """Load a temp_dir path from a persisted token. Returns None if missing or expired."""
    path = _session_file(token)
    try:
        mtime = os.path.getmtime(path)
        if time.time() - mtime > _UPLOAD_TTL:
            # Expired — clean up
            _expire_session(path)
            return None
        with open(path, 'r') as f:
            temp_dir = f.read().strip()
        if os.path.isdir(temp_dir):
            return temp_dir
        # Directory gone — clean up stale marker
        os.remove(path)
        return None
    except FileNotFoundError:
        return None


def _expire_session(marker_path):
    """Remove an expired session marker and its temp directory."""
    try:
        with open(marker_path, 'r') as f:
            temp_dir = f.read().strip()
        if os.path.isdir(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        os.remove(marker_path)
    except Exception:
        pass


def _cleanup_expired_sessions():
    """Sweep the session root and remove anything older than _UPLOAD_TTL."""
    now = time.time()
    try:
        for fname in os.listdir(_UPLOAD_SESSION_ROOT):
            if not fname.endswith('.session'):
                continue
            fpath = os.path.join(_UPLOAD_SESSION_ROOT, fname)
            try:
                if now - os.path.getmtime(fpath) > _UPLOAD_TTL:
                    _expire_session(fpath)
            except Exception:
                pass
    except Exception:
        pass


def _safe_extract_zip(zip_path, dest_dir):
    """Extract a ZIP file while guarding against Zip Slip (path traversal).

    Raises ValueError if any entry would escape *dest_dir*.
    """
    abs_dest = os.path.abspath(dest_dir)
    with zipfile.ZipFile(zip_path, 'r') as zf:
        for member in zf.infolist():
            # Skip directory entries
            if member.is_dir():
                continue
            target = os.path.abspath(os.path.join(abs_dest, member.filename))
            if not target.startswith(abs_dest + os.sep):
                raise ValueError(
                    f"Zip entry escapes target directory: {member.filename}"
                )
        # All entries validated — extract
        zf.extractall(dest_dir)


@app.route('/api/upload', methods=['POST'])
def upload_files():
    from parsers import (
        C_EXTENSIONS, H_EXTENSIONS, CPP_EXTENSIONS, JS_EXTENSIONS,
        PY_EXTENSIONS, JAVA_EXTENSIONS, GO_EXTENSIONS, RUST_EXTENSIONS,
        CS_EXTENSIONS, SWIFT_EXTENSIONS, RUBY_EXTENSIONS,
    )

    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    allowed_ext = (('.zip',) + C_EXTENSIONS + H_EXTENSIONS + CPP_EXTENSIONS
                   + JS_EXTENSIONS + PY_EXTENSIONS + JAVA_EXTENSIONS
                   + GO_EXTENSIONS + RUST_EXTENSIONS + CS_EXTENSIONS
                   + SWIFT_EXTENSIONS + RUBY_EXTENSIONS)
    if not file.filename.endswith(allowed_ext):
        return jsonify({"error": "Unsupported file type. Please upload a ZIP or supported source file."}), 400

    # Generate an opaque upload token for this session
    upload_token = secrets.token_urlsafe(16)

    temp_dir = tempfile.mkdtemp()

    try:
        saved_path = os.path.join(temp_dir, secure_filename(file.filename))
        file.save(saved_path)

        if saved_path.endswith('.zip'):
            _safe_extract_zip(saved_path, temp_dir)

        detected = detect_languages(temp_dir)
        filters = parse_filters(request.form, detected=detected)
        result = build_graph(temp_dir, **filters)
        result["detected"] = detected
        # Return an opaque token — never expose the real filesystem path
        result["upload_token"] = upload_token

        # Persist the session to disk so all workers can resolve it
        _save_upload_session(upload_token, temp_dir)
        # Opportunistically clean up expired sessions
        _cleanup_expired_sessions()

        return jsonify(result)
    except ValueError as e:
        shutil.rmtree(temp_dir, ignore_errors=True)
        return jsonify({"error": "Invalid archive contents."}), 400
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        return jsonify({"error": "Failed to process uploaded file."}), 500


@app.route('/api/diff', methods=['POST'])
def diff_graphs():
    """Accept two JSON graph payloads and return a merged diff view."""
    body, err = _get_json_body()
    if err: return err
    old = body.get('old', {})
    new = body.get('new', {})

    old_node_ids = {n["data"]["id"] for n in old.get("nodes", [])}
    new_node_ids = {n["data"]["id"] for n in new.get("nodes", [])}

    old_edge_keys = {(e["data"]["source"], e["data"]["target"])
                     for e in old.get("edges", [])}
    new_edge_keys = {(e["data"]["source"], e["data"]["target"])
                     for e in new.get("edges", [])}

    nodes = []
    for n in new.get("nodes", []):
        nid = n["data"]["id"]
        status = "added" if nid not in old_node_ids else "unchanged"
        nodes.append({"data": {**n["data"], "diff": status}})
    for n in old.get("nodes", []):
        nid = n["data"]["id"]
        if nid not in new_node_ids:
            nodes.append({"data": {**n["data"], "diff": "removed"}})

    edges = []
    for e in new.get("edges", []):
        key = (e["data"]["source"], e["data"]["target"])
        status = "added" if key not in old_edge_keys else "unchanged"
        edges.append({"data": {**e["data"], "diff": status}})
    for e in old.get("edges", []):
        key = (e["data"]["source"], e["data"]["target"])
        if key not in new_edge_keys:
            edges.append({"data": {**e["data"], "diff": "removed"}})

    return jsonify({"nodes": nodes, "edges": edges})


@app.route('/api/layers', methods=['POST'])
def check_layers():
    """Check for layering violations given a layer ordering and a graph.

    Expects JSON: {"layers": ["ui", "service", "data", "util"],
                    "graph": { ...graph payload... }}

    A violation occurs when a file in a lower layer imports from a higher layer.
    """
    body, err = _get_json_body()
    if err: return err
    layer_order = body.get('layers', [])
    graph = body.get('graph', {})

    if not layer_order:
        return jsonify({"violations": [], "error": "No layers defined"}), 400

    layer_rank = {name.lower(): i for i, name in enumerate(layer_order)}

    def _layer_of(filepath):
        parts = filepath.replace('\\', '/').split('/')
        for part in parts:
            low = part.lower()
            if low in layer_rank:
                return low, layer_rank[low]
        return None, None

    violations = []
    for edge in graph.get("edges", []):
        src = edge["data"]["source"]
        tgt = edge["data"]["target"]
        src_layer, src_rank = _layer_of(src)
        tgt_layer, tgt_rank = _layer_of(tgt)
        if src_rank is not None and tgt_rank is not None and tgt_rank < src_rank:
            violations.append({
                "source": src, "target": tgt,
                "source_layer": src_layer, "target_layer": tgt_layer,
            })

    return jsonify({"violations": violations})


@app.route('/api/rules', methods=['POST'])
def check_rules():
    """Check dependency rules against the current graph.

    Expects JSON: {
        "rules": [
            {"type": "forbidden", "source": "<pattern>", "target": "<pattern>"},
            {"type": "required", "source": "<pattern>", "target": "<pattern>"}
        ],
        "graph": { ...graph payload... }
    }
    """
    body, err = _get_json_body()
    if err: return err
    rules = body.get('rules', [])
    graph = body.get('graph', {})

    if not rules:
        return jsonify({"violations": [], "error": "No rules defined"}), 400

    nodes = {n["data"]["id"] for n in graph.get("nodes", [])}
    edges = graph.get("edges", [])

    violations = []

    for rule in rules:
        rule_type = rule.get('type', 'forbidden')
        src_pattern = rule.get('source', '').strip()
        tgt_pattern = rule.get('target', '').strip()

        if not src_pattern or not tgt_pattern:
            continue

        if rule_type == 'forbidden':
            for edge in edges:
                src = edge["data"]["source"]
                tgt = edge["data"]["target"]
                if src_pattern in src and tgt_pattern in tgt:
                    violations.append({
                        "source": src,
                        "target": tgt,
                        "rule_type": "forbidden",
                        "rule_desc": f"{src_pattern} must not depend on {tgt_pattern}",
                    })

        elif rule_type == 'required':
            matching_sources = [n for n in nodes if src_pattern in n]
            for edge in edges:
                src = edge["data"]["source"]
                tgt = edge["data"]["target"]
                if src in matching_sources and tgt_pattern not in tgt:
                    violations.append({
                        "source": src,
                        "target": tgt,
                        "rule_type": "required",
                        "rule_desc": f"{src_pattern} must only depend on {tgt_pattern}",
                    })

    return jsonify({"violations": violations})


@app.route('/api/simulate', methods=['POST'])
def simulate_removal():
    """Simulate removing a node or edge and report what would break.

    Expects JSON: {
        "graph": { ...graph payload... },
        "remove_nodes": ["file_id", ...],
        "remove_edges": [{"source": "a", "target": "b"}, ...]
    }
    """
    body, err = _get_json_body()
    if err: return err
    graph = body.get('graph', {})
    remove_nodes = set(body.get('remove_nodes', []))
    remove_edges = {(e['source'], e['target'])
                    for e in body.get('remove_edges', [])}

    orig_nodes = graph.get('nodes', [])
    orig_edges = graph.get('edges', [])

    if not remove_nodes and not remove_edges:
        return jsonify({"error": "Nothing to simulate — specify remove_nodes or remove_edges"}), 400

    # Original node set & adjacency
    orig_node_ids = {n['data']['id'] for n in orig_nodes}
    orig_adj = {}
    orig_rev = {}
    for nid in orig_node_ids:
        orig_adj[nid] = []
        orig_rev[nid] = []
    for e in orig_edges:
        s, t = e['data']['source'], e['data']['target']
        if s in orig_adj:
            orig_adj[s].append(t)
        if t in orig_rev:
            orig_rev[t].append(s)

    # --- Build new graph after removal ---
    new_node_ids = orig_node_ids - remove_nodes
    new_edges = []
    for e in orig_edges:
        s, t = e['data']['source'], e['data']['target']
        if s in remove_nodes or t in remove_nodes:
            continue
        if (s, t) in remove_edges:
            continue
        new_edges.append(e)

    new_adj = {nid: [] for nid in new_node_ids}
    new_rev = {nid: [] for nid in new_node_ids}
    for e in new_edges:
        s, t = e['data']['source'], e['data']['target']
        if s in new_adj:
            new_adj[s].append(t)
        if t in new_rev:
            new_rev[t].append(s)

    # --- Broken imports ---
    broken_imports = []
    for e in orig_edges:
        s, t = e['data']['source'], e['data']['target']
        if s in remove_nodes:
            continue
        if t in remove_nodes:
            broken_imports.append({"file": s, "missing_dep": t, "reason": "target_removed"})
        elif (s, t) in remove_edges:
            broken_imports.append({"file": s, "missing_dep": t, "reason": "edge_removed"})

    # --- Orphaned files ---
    newly_orphaned = []
    for nid in new_node_ids:
        had_inbound = len(orig_rev.get(nid, [])) > 0
        now_inbound = len(new_rev.get(nid, []))
        if had_inbound and now_inbound == 0:
            newly_orphaned.append(nid)

    # --- Disconnected subgraphs ---
    new_roots = [nid for nid in new_node_ids if len(new_rev.get(nid, [])) == 0]
    reachable = set()
    stack = list(new_roots)
    while stack:
        cur = stack.pop()
        if cur in reachable:
            continue
        reachable.add(cur)
        for dep in new_adj.get(cur, []):
            if dep not in reachable:
                stack.append(dep)

    # --- Cycle changes ---
    orig_sccs = find_sccs(orig_adj)
    orig_cycles = [scc for scc in orig_sccs if len(scc) > 1]

    new_sccs = find_sccs(new_adj)
    new_cycles = [scc for scc in new_sccs if len(scc) > 1]

    orig_cycle_sets = [frozenset(c) for c in orig_cycles]
    new_cycle_sets = [frozenset(c) for c in new_cycles]

    resolved_cycles = [sorted(list(c)) for c in orig_cycle_sets if c not in new_cycle_sets]
    new_introduced_cycles = [sorted(list(c)) for c in new_cycle_sets if c not in orig_cycle_sets]

    # --- Impact summary ---
    impact_changes = []
    for nid in new_node_ids:
        orig_imp = 0
        for n in orig_nodes:
            if n['data']['id'] == nid:
                orig_imp = n['data'].get('impact', 0)
                break

        visited = set()
        q = [nid]
        while q:
            cur = q.pop(0)
            for dep in new_rev.get(cur, []):
                if dep not in visited and dep != nid:
                    visited.add(dep)
                    q.append(dep)
        new_imp = len(visited)

        if orig_imp != new_imp:
            impact_changes.append({
                "file": nid,
                "old_impact": orig_imp,
                "new_impact": new_imp,
                "delta": new_imp - orig_imp,
            })

    impact_changes.sort(key=lambda x: abs(x['delta']), reverse=True)

    return jsonify({
        "broken_imports": broken_imports,
        "newly_orphaned": sorted(newly_orphaned),
        "resolved_cycles": resolved_cycles,
        "new_cycles": new_introduced_cycles,
        "impact_changes": impact_changes[:30],
        "stats": {
            "removed_nodes": sorted(list(remove_nodes)),
            "removed_edges": [{"source": s, "target": t} for s, t in remove_edges],
            "original_node_count": len(orig_node_ids),
            "new_node_count": len(new_node_ids),
            "original_edge_count": len(orig_edges),
            "new_edge_count": len(new_edges),
            "broken_import_count": len(broken_imports),
            "orphaned_count": len(newly_orphaned),
            "cycles_resolved": len(resolved_cycles),
            "cycles_introduced": len(new_introduced_cycles),
        },
    })


@app.route('/api/story', methods=['POST'])
def generate_story():
    """Generate a guided narrative walkthrough of the dependency graph."""
    try:
        return _generate_story_impl()
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Story generation failed: {exc}"}), 500


def _generate_story_impl():
    body, err = _get_json_body()
    if err: return err
    graph = body.get('graph', {})
    nodes = graph.get('nodes', [])
    edges = graph.get('edges', [])
    cycles = graph.get('cycles', [])

    if not nodes:
        return jsonify({"steps": [], "error": "No graph data provided"}), 400

    # Pre-compute lookups
    node_map = {n['data']['id']: n['data'] for n in nodes}
    in_deg = {nid: 0 for nid in node_map}
    out_deg = {nid: 0 for nid in node_map}
    for e in edges:
        s, t = e['data']['source'], e['data']['target']
        if t in in_deg:
            in_deg[t] += 1
        if s in out_deg:
            out_deg[s] += 1

    # Reverse adjacency for dependents
    rev_adj = {nid: [] for nid in node_map}
    for e in edges:
        rev_adj.setdefault(e['data']['target'], []).append(e['data']['source'])

    total = len(nodes)
    total_edges = len(edges)
    steps = []

    # -- Step 1: Overview --
    dir_set = set()
    for n in nodes:
        nid = n['data']['id']
        d = nid.rsplit('/', 1)[0] if '/' in nid else '.'
        dir_set.add(d)

    steps.append({
        "step_type": "overview",
        "title": "Project Overview",
        "narrative": (
            f"This project contains {total} source file{'s' if total != 1 else ''} "
            f"connected by {total_edges} dependency edge{'s' if total_edges != 1 else ''}, "
            f"spread across {len(dir_set)} director{'ies' if len(dir_set) != 1 else 'y'}. "
            "Let\u2019s walk through the architecture."
        ),
        "highlight_nodes": [],
        "highlight_edges": [],
        "zoom_target": None,
    })

    # -- Step 2: Entry Points --
    entry_points = sorted(
        [nid for nid, deg in in_deg.items() if deg == 0],
        key=lambda x: out_deg.get(x, 0), reverse=True,
    )
    if entry_points:
        top_entries = entry_points[:5]
        if len(entry_points) == 1:
            desc = (
                f"There is one entry point: {entry_points[0]}. "
                "This file is not imported by anything else \u2014 it\u2019s where execution begins."
            )
        else:
            listed = ", ".join(top_entries[:3])
            desc = (
                f"There are {len(entry_points)} entry points (files with no inbound imports). "
                f"The most connected are: {listed}. "
                "These are the roots of the dependency tree \u2014 nothing imports them, "
                "but they pull in other modules."
            )
        steps.append({
            "step_type": "entry_points",
            "title": "Entry Points",
            "narrative": desc,
            "highlight_nodes": top_entries,
            "highlight_edges": [],
            "zoom_target": top_entries[0] if top_entries else None,
        })

    # -- Step 3: Hub Files --
    by_in = sorted(node_map.keys(), key=lambda x: in_deg.get(x, 0), reverse=True)
    hubs = [nid for nid in by_in if in_deg.get(nid, 0) >= 3][:5]
    if hubs:
        top_hub = hubs[0]
        top_count = in_deg[top_hub]
        hub_impact = node_map[top_hub].get('impact', 0)
        pct = round(hub_impact / total * 100) if total > 0 else 0

        desc = (
            f"The most-imported file is {top_hub}, referenced by {top_count} other files. "
            f"Changes here ripple out to {hub_impact} file{'s' if hub_impact != 1 else ''} "
            f"({pct}% of the project). "
        )
        if len(hubs) > 1:
            desc += f"Other key hubs include: {', '.join(hubs[1:3])}. "
        desc += "These are the load-bearing walls of your codebase \u2014 tread carefully."

        hub_edges = []
        for e in edges:
            if e['data']['target'] == top_hub:
                hub_edges.append({"source": e['data']['source'], "target": e['data']['target']})

        steps.append({
            "step_type": "hubs",
            "title": "Critical Hubs",
            "narrative": desc,
            "highlight_nodes": hubs,
            "highlight_edges": hub_edges[:20],
            "zoom_target": top_hub,
        })

    # -- Step 4: Deepest Dependency Chains --
    by_depth = sorted(node_map.keys(),
                      key=lambda x: node_map[x].get('depth', 0), reverse=True)
    deepest = [(nid, node_map[nid].get('depth', 0)) for nid in by_depth
               if node_map[nid].get('depth', 0) >= 2][:5]
    if deepest:
        top_nid, top_depth = deepest[0]
        desc = (
            f"The longest dependency chain is {top_depth} levels deep, "
            f"starting from {top_nid}. "
            "Deep chains mean a change at the bottom can cascade through many layers. "
        )
        if len(deepest) > 1:
            others = ", ".join(f"{nid} (depth {d})" for nid, d in deepest[1:3])
            desc += f"Other deep files: {others}. "
        desc += "Consider whether these chains are intentional or accidental complexity."

        steps.append({
            "step_type": "depth",
            "title": "Deepest Chains",
            "narrative": desc,
            "highlight_nodes": [nid for nid, _ in deepest],
            "highlight_edges": [],
            "zoom_target": top_nid,
        })

    # -- Step 5: Circular Dependencies --
    if cycles:
        cycle_nodes = set()
        for c in cycles:
            for nid in c:
                cycle_nodes.add(nid)
        cycle_edge_list = []
        for e in edges:
            if e.get('classes') and 'cycle' in e['classes']:
                cycle_edge_list.append({
                    "source": e['data']['source'], "target": e['data']['target']
                })

        desc = (
            f"There {'is' if len(cycles) == 1 else 'are'} "
            f"{len(cycles)} circular dependency loop{'s' if len(cycles) != 1 else ''} "
            f"involving {len(cycle_nodes)} file{'s' if len(cycle_nodes) != 1 else ''}. "
            "Cycles make code harder to test, refactor, and reason about. "
        )
        if len(cycles) == 1:
            desc += f"The cycle includes: {', '.join(cycles[0][:4])}."
        else:
            desc += f"The largest cycle has {max(len(c) for c in cycles)} files."

        steps.append({
            "step_type": "cycles",
            "title": "Circular Dependencies",
            "narrative": desc,
            "highlight_nodes": sorted(cycle_nodes),
            "highlight_edges": cycle_edge_list[:30],
            "zoom_target": list(cycle_nodes)[0] if cycle_nodes else None,
        })
    else:
        steps.append({
            "step_type": "cycles",
            "title": "No Circular Dependencies",
            "narrative": (
                "Good news \u2014 there are no circular dependency loops in this project. "
                "That\u2019s a sign of clean, well-layered architecture."
            ),
            "highlight_nodes": [],
            "highlight_edges": [],
            "zoom_target": None,
        })

    # -- Step 6: Stability Risks --
    risky = []
    for nid, data in node_map.items():
        impact = data.get('impact', 0)
        stability = data.get('stability', 0.5)
        if impact >= 2 and stability > 0.6:
            risky.append((nid, impact, stability))
    risky.sort(key=lambda x: x[1] * x[2], reverse=True)
    risky = risky[:5]

    if risky:
        top_r = risky[0]
        desc = (
            f"The riskiest file is {top_r[0]} \u2014 it affects {top_r[1]} files "
            f"but has a high instability score of {top_r[2]}. "
            "High-impact, unstable files are the most dangerous: they change often "
            "and break a lot when they do. "
        )
        if len(risky) > 1:
            others = ", ".join(r[0] for r in risky[1:3])
            desc += f"Other risky files: {others}."
        else:
            desc += "Consider stabilizing this file by reducing its outbound dependencies."

        steps.append({
            "step_type": "risks",
            "title": "Stability Risks",
            "narrative": desc,
            "highlight_nodes": [r[0] for r in risky],
            "highlight_edges": [],
            "zoom_target": top_r[0],
        })

    # -- Step 7: Directory Coupling --
    coupling = graph.get('coupling', [])
    high_coupling = [c for c in coupling if c.get('score', 0) > 0.1]
    if high_coupling:
        top_c = high_coupling[0]
        desc = (
            f"The most coupled directories are {top_c['dir1']} and {top_c['dir2']}, "
            f"sharing {top_c['cross_edges']} cross-boundary edges (score: {top_c['score']}). "
            "High coupling between directories can indicate unclear boundaries. "
        )
        if len(high_coupling) > 1:
            desc += (
                f"There are {len(high_coupling)} directory pairs with notable coupling."
            )

        steps.append({
            "step_type": "coupling",
            "title": "Directory Coupling",
            "narrative": desc,
            "highlight_nodes": [],
            "highlight_edges": [],
            "zoom_target": None,
        })

    # -- Step 8: Summary & Recommendations --
    recs = []
    if cycles:
        recs.append(f"Break {len(cycles)} circular dependency loop{'s' if len(cycles) != 1 else ''}")
    if risky:
        recs.append(f"Stabilize {len(risky)} high-risk file{'s' if len(risky) != 1 else ''}")
    if hubs and in_deg.get(hubs[0], 0) > total * 0.3:
        recs.append(f"Consider splitting {hubs[0]} \u2014 it\u2019s a god file")
    if high_coupling:
        recs.append("Clarify directory boundaries to reduce coupling")
    if not recs:
        recs.append("Architecture looks healthy \u2014 keep it up!")

    steps.append({
        "step_type": "summary",
        "title": "Summary",
        "narrative": (
            "That\u2019s the full picture. "
            + ("Key recommendations: " + "; ".join(recs) + "."
               if recs else "")
        ),
        "highlight_nodes": [],
        "highlight_edges": [],
        "zoom_target": None,
    })

    return jsonify({"steps": steps, "total_steps": len(steps)})


@app.route('/api/csrf-token', methods=['GET'])
def get_csrf_token():
    """Return a CSRF token for the frontend to include in POST requests."""
    return jsonify({"token": _csrf_token})


# Set DEPGRAPH_CSRF=false to disable CSRF checks during local development.
_CSRF_ENABLED = os.environ.get('DEPGRAPH_CSRF', 'true').lower() != 'false'


@app.before_request
def _check_csrf():
    """Validate CSRF token on state-changing requests (skipped when disabled)."""
    if not _CSRF_ENABLED:
        return
    if request.method in ('POST', 'PUT', 'DELETE', 'PATCH'):
        token = (request.headers.get('X-CSRF-Token')
                 or request.form.get('_csrf_token'))
        if token != _csrf_token:
            return jsonify({"error": "Invalid or missing CSRF token."}), 403


if __name__ == '__main__':
    import os
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', debug=debug, port=port)
