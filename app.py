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

# Python: import foo, import foo.bar, from foo import bar, from . import bar
_PY_FROM_IMPORT_RE = re.compile(
    r'^from\s+(\.{0,3}[\w.]*)\s+import\s+(.+)$', re.MULTILINE
)
_PY_IMPORT_RE = re.compile(
    r'^import\s+([\w.]+(?:\s*,\s*[\w.]+)*)\s*$', re.MULTILINE
)

# Java: import com.example.Foo; or import static com.example.Foo.bar;
_JAVA_IMPORT_RE = re.compile(
    r'^import\s+(?:static\s+)?([\w.*]+)\s*;', re.MULTILINE
)

# Go: import "path" or import ( "path" ... )
_GO_IMPORT_RE = re.compile(
    r'import\s+(?:\(\s*((?:[^)]*?))\s*\)|"([^"]+)")', re.DOTALL
)
_GO_IMPORT_PATH_RE = re.compile(r'"([^"]+)"')

# Rust: use path::to::thing; mod foo; extern crate bar;
_RUST_USE_RE = re.compile(r'^use\s+([\w:]+)', re.MULTILINE)
_RUST_MOD_RE = re.compile(r'^mod\s+(\w+)\s*;', re.MULTILINE)
_RUST_EXTERN_RE = re.compile(r'^extern\s+crate\s+(\w+)\s*;', re.MULTILINE)

# --- File extension groups ---
_C_EXTENSIONS = ('.c',)
_H_EXTENSIONS = ('.h',)
_CPP_EXTENSIONS = ('.cpp', '.cc', '.cxx', '.hpp', '.hxx')
_JS_EXTENSIONS = ('.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx')
_PY_EXTENSIONS = ('.py',)
_JAVA_EXTENSIONS = ('.java',)
_GO_EXTENSIONS = ('.go',)
_RUST_EXTENSIONS = ('.rs',)

# Python standard library module names (top-level) — used to classify system imports
_PY_STDLIB = frozenset([
    'abc', 'aifc', 'argparse', 'array', 'ast', 'asynchat', 'asyncio',
    'asyncore', 'atexit', 'audioop', 'base64', 'bdb', 'binascii', 'binhex',
    'bisect', 'builtins', 'bz2', 'calendar', 'cgi', 'cgitb', 'chunk',
    'cmath', 'cmd', 'code', 'codecs', 'codeop', 'collections', 'colorsys',
    'compileall', 'concurrent', 'configparser', 'contextlib', 'contextvars',
    'copy', 'copyreg', 'cProfile', 'crypt', 'csv', 'ctypes', 'curses',
    'dataclasses', 'datetime', 'dbm', 'decimal', 'difflib', 'dis',
    'distutils', 'doctest', 'email', 'encodings', 'enum', 'errno',
    'faulthandler', 'fcntl', 'filecmp', 'fileinput', 'fnmatch', 'formatter',
    'fractions', 'ftplib', 'functools', 'gc', 'getopt', 'getpass', 'gettext',
    'glob', 'grp', 'gzip', 'hashlib', 'heapq', 'hmac', 'html', 'http',
    'idlelib', 'imaplib', 'imghdr', 'imp', 'importlib', 'inspect', 'io',
    'ipaddress', 'itertools', 'json', 'keyword', 'lib2to3', 'linecache',
    'locale', 'logging', 'lzma', 'mailbox', 'mailcap', 'marshal', 'math',
    'mimetypes', 'mmap', 'modulefinder', 'multiprocessing', 'netrc', 'nis',
    'nntplib', 'numbers', 'operator', 'optparse', 'os', 'ossaudiodev',
    'parser', 'pathlib', 'pdb', 'pickle', 'pickletools', 'pipes', 'pkgutil',
    'platform', 'plistlib', 'poplib', 'posix', 'posixpath', 'pprint',
    'profile', 'pstats', 'pty', 'pwd', 'py_compile', 'pyclbr', 'pydoc',
    'queue', 'quopri', 'random', 're', 'readline', 'reprlib', 'resource',
    'rlcompleter', 'runpy', 'sched', 'secrets', 'select', 'selectors',
    'shelve', 'shlex', 'shutil', 'signal', 'site', 'smtpd', 'smtplib',
    'sndhdr', 'socket', 'socketserver', 'spwd', 'sqlite3', 'ssl', 'stat',
    'statistics', 'string', 'stringprep', 'struct', 'subprocess', 'sunau',
    'symtable', 'sys', 'sysconfig', 'syslog', 'tabnanny', 'tarfile',
    'telnetlib', 'tempfile', 'termios', 'test', 'textwrap', 'threading',
    'time', 'timeit', 'tkinter', 'token', 'tokenize', 'trace', 'traceback',
    'tracemalloc', 'tty', 'turtle', 'turtledemo', 'types', 'typing',
    'unicodedata', 'unittest', 'urllib', 'uu', 'uuid', 'venv', 'warnings',
    'wave', 'weakref', 'webbrowser', 'winreg', 'winsound', 'wsgiref',
    'xdrlib', 'xml', 'xmlrpc', 'zipapp', 'zipfile', 'zipimport', 'zlib',
    '_thread', '__future__',
])

# Go standard library prefixes — packages without a dot in the path are stdlib
# We detect local vs stdlib by checking against go.mod module path


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


def _wanted_extension(filename, show_c, show_h, show_cpp, show_js=False,
                      show_py=False, show_java=False, show_go=False,
                      show_rust=False):
    """Check whether a filename has an extension we want to include."""
    if filename.endswith(_C_EXTENSIONS) and show_c:
        return True
    if filename.endswith(_H_EXTENSIONS) and show_h:
        return True
    if filename.endswith(_CPP_EXTENSIONS) and show_cpp:
        return True
    if filename.endswith(_JS_EXTENSIONS) and show_js:
        return True
    if filename.endswith(_PY_EXTENSIONS) and show_py:
        return True
    if filename.endswith(_JAVA_EXTENSIONS) and show_java:
        return True
    if filename.endswith(_GO_EXTENSIONS) and show_go:
        return True
    if filename.endswith(_RUST_EXTENSIONS) and show_rust:
        return True
    return False


def _include_target_excluded(filename, show_c, show_h, show_cpp, show_js=False,
                             show_py=False, show_java=False, show_go=False,
                             show_rust=False):
    """Return True if an include/import target should be excluded."""
    if filename.endswith(_C_EXTENSIONS) and not show_c:
        return True
    if filename.endswith(_H_EXTENSIONS) and not show_h:
        return True
    if filename.endswith(_CPP_EXTENSIONS) and not show_cpp:
        return True
    if filename.endswith(_JS_EXTENSIONS) and not show_js:
        return True
    if filename.endswith(_PY_EXTENSIONS) and not show_py:
        return True
    if filename.endswith(_JAVA_EXTENSIONS) and not show_java:
        return True
    if filename.endswith(_GO_EXTENSIONS) and not show_go:
        return True
    if filename.endswith(_RUST_EXTENSIONS) and not show_rust:
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

def _collect_source_files(directory, show_c, show_h, show_cpp, show_js=False,
                          show_py=False, show_java=False, show_go=False,
                          show_rust=False):
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

    result = []
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not _should_skip_dir(d)
                   and d not in skip_dirs]
        for fname in files:
            if _should_skip_file(fname):
                continue
            if _wanted_extension(fname, show_c, show_h, show_cpp, show_js,
                                 show_py, show_java, show_go, show_rust):
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


def _resolve_py_import(module_path, source_file, directory, known_files):
    """Resolve a Python import to a file path.

    *module_path* is the dotted module string (e.g. ``foo.bar`` or ``.bar``
    for relative imports).  Returns ``(resolved_path, is_external)``.
    """
    is_relative = module_path.startswith('.')

    if is_relative:
        # Count leading dots
        dots = len(module_path) - len(module_path.lstrip('.'))
        remainder = module_path.lstrip('.')
        source_dir = os.path.dirname(source_file)
        # Go up (dots - 1) directories from source_dir
        base = source_dir
        for _ in range(dots - 1):
            base = os.path.dirname(base)
        parts = remainder.split('.') if remainder else []
        candidate_dir = os.path.join(base, *parts) if parts else base
    else:
        top_level = module_path.split('.')[0]
        if top_level in _PY_STDLIB:
            return module_path, True
        parts = module_path.split('.')
        candidate_dir = os.path.join(*parts)

    # Try as a module file
    candidate_file = candidate_dir + '.py'
    if candidate_file in known_files:
        return candidate_file, False

    # Try as a package __init__.py
    candidate_init = os.path.join(candidate_dir, '__init__.py')
    if candidate_init in known_files:
        return candidate_init, False

    # If it doesn't resolve locally, treat as external
    if not is_relative:
        return module_path, True

    return candidate_file, False


def _resolve_java_import(import_path, directory, known_files):
    """Resolve a Java import to source files.

    Returns a list of ``(resolved_path, is_external)`` tuples.
    Wildcard imports expand to all ``.java`` files in the matching directory.
    """
    is_wildcard = import_path.endswith('.*')
    if is_wildcard:
        # com.example.* → com/example/
        pkg = import_path[:-2].replace('.', os.sep)
        matches = [f for f in known_files
                   if f.startswith(pkg + os.sep) and f.endswith('.java')
                   and os.sep not in f[len(pkg) + 1:]]
        if matches:
            return [(m, False) for m in matches]
        return [(import_path, True)]
    else:
        # com.example.Foo → com/example/Foo.java
        candidate = import_path.replace('.', os.sep) + '.java'
        if candidate in known_files:
            return [(candidate, False)]
        return [(import_path, True)]


def _parse_go_mod(directory):
    """Read go.mod and return the module path, or None."""
    go_mod = os.path.join(directory, 'go.mod')
    if not os.path.isfile(go_mod):
        return None
    with open(go_mod, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            line = line.strip()
            if line.startswith('module '):
                return line[len('module '):].strip()
    return None


def _resolve_go_import(import_path, directory, known_files, module_path):
    """Resolve a Go import path.

    Returns ``(resolved_path, is_external)``.
    """
    if module_path and import_path.startswith(module_path):
        # Local import: strip module path prefix to get relative path
        rel = import_path[len(module_path):].lstrip('/')
        # A Go import points to a package (directory), find .go files there
        matches = [f for f in known_files
                   if f.startswith(rel + '/') or f.startswith(rel + os.sep)]
        if matches:
            # Return the directory as the node (package-level)
            return rel, False
        return import_path, True
    # Standard library: no dots in path
    if '.' not in import_path.split('/')[0]:
        return import_path, True
    # Third-party
    return import_path, True


def _resolve_rust_mod(mod_name, source_file, directory, known_files):
    """Resolve a Rust ``mod foo;`` declaration.

    Follows Rust conventions: ``foo.rs`` or ``foo/mod.rs`` relative to the
    declaring file's directory.
    """
    source_dir = os.path.dirname(source_file)
    # Try sibling file
    candidate = os.path.join(source_dir, mod_name + '.rs')
    if candidate in known_files:
        return candidate, False
    # Try directory with mod.rs
    candidate = os.path.join(source_dir, mod_name, 'mod.rs')
    if candidate in known_files:
        return candidate, False
    return os.path.join(source_dir, mod_name + '.rs'), False


def _build_graph(directory, hide_system=False, show_c=True, show_h=True,
                 show_cpp=True, show_js=False, show_py=False,
                 show_java=False, show_go=False, show_rust=False,
                 hide_isolated=False, filter_dir=""):
    """Parse source files and return the dependency graph as a dict.

    Returns a dict with keys ``nodes``, ``edges``, ``has_cycles``, and
    ``cycles``.
    """
    nodes = []
    edges = []
    node_set = set()

    files_to_parse = _collect_source_files(
        directory, show_c, show_h, show_cpp, show_js,
        show_py, show_java, show_go, show_rust,
    )

    # Build a set of known relative paths for import resolution
    known_files = {os.path.relpath(fp, directory) for fp in files_to_parse}

    # Pre-read go.mod if Go is enabled
    go_module_path = _parse_go_mod(directory) if show_go else None

    def _add_edge(source, target):
        edges.append({
            "data": {
                "source": source,
                "target": target,
                "color": _color_for_path(source),
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

        is_js_file = filepath.endswith(_JS_EXTENSIONS)
        is_py_file = filepath.endswith(_PY_EXTENSIONS)
        is_java_file = filepath.endswith(_JAVA_EXTENSIONS)
        is_go_file = filepath.endswith(_GO_EXTENSIONS)
        is_rust_file = filepath.endswith(_RUST_EXTENSIONS)

        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()

        # --- Python imports ---
        if is_py_file:
            # "from X import a, b" style
            for m in _PY_FROM_IMPORT_RE.finditer(content):
                from_path = m.group(1)  # e.g. "utils.helpers" or "." or ".models"
                names = m.group(2)      # e.g. "format_output" or "config, utils"
                if from_path and not from_path.replace('.', ''):
                    # Pure relative: "from . import config" → resolve each name
                    for name in names.split(','):
                        name = name.strip()
                        if not name or name == '*':
                            continue
                        mod = from_path + name
                        resolved, is_external = _resolve_py_import(
                            mod, filename, directory, known_files
                        )
                        if hide_system and is_external:
                            continue
                        _add_edge(filename, resolved)
                else:
                    # "from foo.bar import X" → resolve foo.bar
                    resolved, is_external = _resolve_py_import(
                        from_path, filename, directory, known_files
                    )
                    if hide_system and is_external:
                        continue
                    _add_edge(filename, resolved)
            # "import X, Y" style
            for m in _PY_IMPORT_RE.finditer(content):
                for mod in m.group(1).split(','):
                    mod = mod.strip()
                    if not mod:
                        continue
                    resolved, is_external = _resolve_py_import(
                        mod, filename, directory, known_files
                    )
                    if hide_system and is_external:
                        continue
                    _add_edge(filename, resolved)
            continue

        # --- Java imports ---
        if is_java_file:
            for m in _JAVA_IMPORT_RE.finditer(content):
                import_path = m.group(1)
                resolved_list = _resolve_java_import(
                    import_path, directory, known_files
                )
                for resolved, is_external in resolved_list:
                    if hide_system and is_external:
                        continue
                    _add_edge(filename, resolved)
            continue

        # --- Go imports ---
        if is_go_file:
            for m in _GO_IMPORT_RE.finditer(content):
                if m.group(1) is not None:
                    # import block: import ( "path1"\n "path2" )
                    for pm in _GO_IMPORT_PATH_RE.finditer(m.group(1)):
                        imp = pm.group(1)
                        resolved, is_external = _resolve_go_import(
                            imp, directory, known_files, go_module_path
                        )
                        if hide_system and is_external:
                            continue
                        _add_edge(filename, resolved)
                else:
                    # single import: import "path"
                    imp = m.group(2)
                    resolved, is_external = _resolve_go_import(
                        imp, directory, known_files, go_module_path
                    )
                    if hide_system and is_external:
                        continue
                    _add_edge(filename, resolved)
            continue

        # --- Rust imports ---
        if is_rust_file:
            for m in _RUST_MOD_RE.finditer(content):
                mod_name = m.group(1)
                resolved, is_external = _resolve_rust_mod(
                    mod_name, filename, directory, known_files
                )
                _add_edge(filename, resolved)
            for m in _RUST_USE_RE.finditer(content):
                use_path = m.group(1)
                top_crate = use_path.split('::')[0]
                if top_crate in ('crate', 'self', 'super'):
                    # Local use — try to resolve to a file
                    parts = use_path.split('::')
                    if parts[0] == 'crate':
                        parts = parts[1:]
                    elif parts[0] == 'self':
                        parts = [os.path.dirname(filename)] + parts[1:]
                    elif parts[0] == 'super':
                        parts = [os.path.dirname(os.path.dirname(filename))] + parts[1:]
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
                    # External crate
                    if hide_system:
                        continue
                    _add_edge(filename, top_crate)
            for m in _RUST_EXTERN_RE.finditer(content):
                crate_name = m.group(1)
                if hide_system:
                    continue
                _add_edge(filename, crate_name)
            continue

        # --- C / C++ and JS/TS (line-by-line) ---
        for line in content.splitlines():
            if not is_js_file:
                match = _INCLUDE_RE.search(line)
                if not match:
                    continue

                is_system = match.group(1) == '<'
                if hide_system and is_system:
                    continue

                included = match.group(2)
                if _include_target_excluded(included, show_c, show_h, show_cpp, show_js,
                                            show_py, show_java, show_go, show_rust):
                    continue

                _add_edge(filename, included)

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

                _add_edge(filename, resolved)

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

    # --- Compute out-degrees ---
    out_degrees = {node["data"]["id"]: 0 for node in nodes}
    for edge in edges:
        src = edge["data"]["source"]
        if src in out_degrees:
            out_degrees[src] += 1

    # --- Dependency depth (longest transitive dependency chain) ---
    dep_depth = {}
    def _compute_depth(node_id, visited):
        if node_id in dep_depth:
            return dep_depth[node_id]
        if node_id in visited:
            return 0  # cycle — break recursion
        visited.add(node_id)
        max_child = 0
        for w in adj.get(node_id, []):
            max_child = max(max_child, 1 + _compute_depth(w, visited))
        visited.discard(node_id)
        dep_depth[node_id] = max_child
        return max_child

    for nid in adj:
        if nid not in dep_depth:
            _compute_depth(nid, set())

    for node in nodes:
        node["data"]["depth"] = dep_depth.get(node["data"]["id"], 0)

    # --- Impact analysis (downstream closure size) ---
    # Reverse adjacency: for each node, who depends on it?
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
        edges = [e for e in edges if e["data"]["source"] in valid_ids and e["data"]["target"] in valid_ids]

    return {
        "nodes": nodes,
        "edges": edges,
        "has_cycles": has_cycle_edges,
        "cycles": cycles_list,
        "unused_files": unused_files,
        "coupling": coupling_scores,
    }


# ---------------------------------------------------------------------------
# Helper to pull filter params from a request
# ---------------------------------------------------------------------------

def _detect_languages(directory):
    """Scan *directory* for source files and return which language groups exist."""
    flags = {
        "has_c": False, "has_h": False, "has_cpp": False, "has_js": False,
        "has_py": False, "has_java": False, "has_go": False, "has_rust": False,
    }
    all_keys = set(flags.keys())
    skip_dirs = {'node_modules', '__pycache__', '.venv', 'venv', 'target', 'vendor'}
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not _should_skip_dir(d) and d not in skip_dirs]
        for fname in files:
            if _should_skip_file(fname):
                continue
            if fname.endswith(_C_EXTENSIONS):
                flags["has_c"] = True
            if fname.endswith(_H_EXTENSIONS):
                flags["has_h"] = True
            if fname.endswith(_CPP_EXTENSIONS):
                flags["has_cpp"] = True
            if fname.endswith(_JS_EXTENSIONS):
                flags["has_js"] = True
            if fname.endswith(_PY_EXTENSIONS):
                flags["has_py"] = True
            if fname.endswith(_JAVA_EXTENSIONS):
                flags["has_java"] = True
            if fname.endswith(_GO_EXTENSIONS):
                flags["has_go"] = True
            if fname.endswith(_RUST_EXTENSIONS):
                flags["has_rust"] = True
            if all(flags.values()):
                return flags
    return flags


def _parse_filters(source, detected=None):
    """Extract filter flags from a request args or form dict.

    When *detected* is provided (a dict from ``_detect_languages``), the
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
    elif mode == 'auto':
        show_c = show_h = show_cpp = show_js = True
        show_py = show_java = show_go = show_rust = True
    else:
        show_c = source.get('show_c', 'true').lower() == 'true'
        show_h = source.get('show_h', 'true').lower() == 'true'
        show_cpp = source.get('show_cpp', 'true').lower() == 'true'
        show_js = source.get('show_js', 'false').lower() == 'true'
        show_py = source.get('show_py', 'false').lower() == 'true'
        show_java = source.get('show_java', 'false').lower() == 'true'
        show_go = source.get('show_go', 'false').lower() == 'true'
        show_rust = source.get('show_rust', 'false').lower() == 'true'

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
        "hide_isolated": source.get('hide_isolated', 'false').lower() == 'true',
        "filter_dir": source.get('filter_dir', ''),
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return app.send_static_file('index.html')


@app.route('/api/detect', methods=['GET'])
def detect_languages():
    """Scan a directory and return which language groups are present."""
    directory = request.args.get('dir', '.')

    if not os.path.isdir(directory):
        return jsonify({"error": f"Directory not found: {directory}"}), 400

    return jsonify(_detect_languages(directory))


@app.route('/api/graph', methods=['GET'])
def get_graph():
    directory = request.args.get('dir', '.')

    if not os.path.isdir(directory):
        return jsonify({"error": f"Directory not found: {directory}"}), 400

    detected = _detect_languages(directory)
    filters = _parse_filters(request.args, detected=detected)
    result = _build_graph(directory, **filters)
    result["detected"] = detected
    return jsonify(result)


@app.route('/api/upload', methods=['POST'])
def upload_files():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    allowed_ext = (('.zip',) + _C_EXTENSIONS + _H_EXTENSIONS + _CPP_EXTENSIONS
                   + _JS_EXTENSIONS + _PY_EXTENSIONS + _JAVA_EXTENSIONS
                   + _GO_EXTENSIONS + _RUST_EXTENSIONS)
    if not file.filename.endswith(allowed_ext):
        return jsonify({"error": "Unsupported file type. Please upload a ZIP or supported source file."}), 400

    temp_dir = tempfile.mkdtemp()

    try:
        saved_path = os.path.join(temp_dir, secure_filename(file.filename))
        file.save(saved_path)

        if saved_path.endswith('.zip'):
            with zipfile.ZipFile(saved_path, 'r') as zf:
                zf.extractall(temp_dir)

        detected = _detect_languages(temp_dir)
        filters = _parse_filters(request.form, detected=detected)
        result = _build_graph(temp_dir, **filters)
        result["detected"] = detected
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        shutil.rmtree(temp_dir)


@app.route('/api/diff', methods=['POST'])
def diff_graphs():
    """Accept two JSON graph payloads and return a merged diff view."""
    body = request.get_json(force=True)
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
    Layer assignment is based on the first matching directory segment in the
    file path.
    """
    body = request.get_json(force=True)
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

    Rule types:
    - forbidden: source must NOT depend on target (any matching edge is a violation)
    - required:  source must ONLY depend on target (edges to non-matching targets are violations)

    Patterns use simple prefix/substring matching against file paths.
    A pattern matches a node if the node's id contains that pattern string.
    """
    body = request.get_json(force=True)
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
            # Flag every edge where source matches src_pattern AND target matches tgt_pattern
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
            # For every source matching src_pattern, flag edges whose target does NOT match tgt_pattern
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


if __name__ == '__main__':
    import os
    debug = os.environ.get('FLASK_DEBUG', 'true').lower() == 'true'
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', debug=debug, port=port)
