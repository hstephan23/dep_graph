"""DepGraph — Flask server for visualizing source file dependencies."""

import os
import re
import hashlib
import tempfile
import zipfile
import shutil
import threading
import time
import secrets

from werkzeug.utils import secure_filename
from flask import Flask, jsonify, request, abort

app = Flask(__name__, static_folder='static')

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

# Cool-tone palette for directory-based node colors (no warm colors to avoid
# confusion with red error/cycle highlights).
_PALETTE = [
    "#6366f1", "#818cf8", "#8b5cf6", "#7c3aed", "#6d28d9",
    "#3b82f6", "#60a5fa", "#0ea5e9", "#06b6d4", "#14b8a6",
    "#0d9488", "#475569", "#64748b", "#7dd3fc", "#a78bfa",
    "#38bdf8", "#2dd4bf", "#a5b4fc", "#94a3b8", "#5eead4",
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

# C#: using System; using System.Collections.Generic; using static Foo.Bar;
_CS_USING_RE = re.compile(
    r'^using\s+(?:static\s+)?([\w.]+)\s*;', re.MULTILINE
)

# --- File extension groups ---
_C_EXTENSIONS = ('.c',)
_H_EXTENSIONS = ('.h',)
_CPP_EXTENSIONS = ('.cpp', '.cc', '.cxx', '.hpp', '.hxx')
_JS_EXTENSIONS = ('.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx')
_PY_EXTENSIONS = ('.py',)
_JAVA_EXTENSIONS = ('.java',)
_GO_EXTENSIONS = ('.go',)
_RUST_EXTENSIONS = ('.rs',)
_CS_EXTENSIONS = ('.cs',)

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

# C# / .NET system namespace prefixes — used to classify BCL/framework imports
_CS_SYSTEM_PREFIXES = (
    'System', 'Microsoft', 'Windows', 'Internal', 'Interop',
)

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
                      show_rust=False, show_cs=False):
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
    if filename.endswith(_CS_EXTENSIONS) and show_cs:
        return True
    return False


def _include_target_excluded(filename, show_c, show_h, show_cpp, show_js=False,
                             show_py=False, show_java=False, show_go=False,
                             show_rust=False, show_cs=False):
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
    if filename.endswith(_CS_EXTENSIONS) and not show_cs:
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
                          show_rust=False, show_cs=False):
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

    result = []
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not _should_skip_dir(d)
                   and d not in skip_dirs]
        for fname in files:
            if _should_skip_file(fname):
                continue
            if _wanted_extension(fname, show_c, show_h, show_cpp, show_js,
                                 show_py, show_java, show_go, show_rust,
                                 show_cs):
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


_CS_NAMESPACE_RE = re.compile(
    r'^\s*namespace\s+([\w.]+)', re.MULTILINE
)


def _build_cs_namespace_map(directory, known_files):
    """Pre-scan .cs files to build a map of declared namespace → [file paths].

    Also builds a class-name → file path map for individual type resolution.
    Returns ``(ns_map, class_map)`` where *ns_map* maps a full namespace string
    to a sorted list of relative file paths and *class_map* maps
    ``Namespace.ClassName`` to the file that likely defines it.
    """
    ns_map = {}   # "MyApp.Models" → ["Models/Order.cs", "Models/User.cs"]
    class_map = {}  # "MyApp.Models.User" → "Models/User.cs"

    for rel_path in known_files:
        if not rel_path.endswith('.cs'):
            continue
        full_path = os.path.join(directory, rel_path)
        try:
            with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except OSError:
            continue

        for m in _CS_NAMESPACE_RE.finditer(content):
            ns = m.group(1)
            ns_map.setdefault(ns, [])
            if rel_path not in ns_map[ns]:
                ns_map[ns].append(rel_path)

            # Map Namespace.FileName (sans extension) → file path
            basename = os.path.splitext(os.path.basename(rel_path))[0]
            class_key = ns + '.' + basename
            class_map[class_key] = rel_path

    # Sort file lists for deterministic output
    for ns in ns_map:
        ns_map[ns] = sorted(ns_map[ns])

    return ns_map, class_map


def _resolve_cs_using(namespace, directory, known_files, ns_map=None,
                      class_map=None):
    """Resolve a C# ``using`` directive to project file(s) if possible.

    C# using directives reference namespaces, not files directly.  Resolution
    proceeds in priority order:

    1. **Namespace map** (most reliable) — match against namespaces actually
       declared in the project's ``.cs`` files.  A ``using`` that matches a
       parent namespace returns *all* files declaring that namespace; a
       ``using`` that matches a ``Namespace.ClassName`` pattern returns just
       that one file.
    2. **Path heuristics** — convert namespace segments to path components
       (with hyphen/underscore normalisation) and look for a matching file
       or directory.
    3. If nothing matches, the namespace is treated as external.

    Returns ``(list_of_resolved_paths, is_external)``.
    """
    # Check for system/framework namespace
    if namespace.startswith(_CS_SYSTEM_PREFIXES):
        return [namespace], True

    # --- Strategy 1: namespace map from actual declarations ---
    if ns_map is not None:
        # Exact namespace match (e.g. "using MyApp.Models;" → all files in
        # the MyApp.Models namespace)
        if namespace in ns_map:
            return ns_map[namespace], False

        # Try as Namespace.ClassName (e.g. "using static MyApp.Models.User;")
        if class_map and namespace in class_map:
            return [class_map[namespace]], False

        # Check if this namespace is a *parent* of any known namespace
        # e.g. "using MyApp;" might want all files in MyApp.* namespaces
        prefix = namespace + '.'
        children = []
        for ns, files in ns_map.items():
            if ns.startswith(prefix) or ns == namespace:
                children.extend(files)
        if children:
            return sorted(set(children)), False

    # --- Strategy 2: path heuristics (fallback) ---
    parts = namespace.split('.')

    def _normalize(s):
        """Normalise a string for fuzzy directory matching."""
        return s.lower().replace('-', '_')

    # Build a normalised lookup of known file directories
    norm_dir_map = {}  # normalised_dir → original_dir
    for f in known_files:
        d = os.path.dirname(f)
        if d:
            norm_dir_map[_normalize(d)] = d

    # 2a. Try to match a specific .cs file
    for start in range(len(parts)):
        for end in range(len(parts), start, -1):
            seg = parts[start:end]
            candidate = os.path.join(*seg) + '.cs'
            if candidate in known_files:
                return [candidate], False
            # Fuzzy: try with hyphens replaced by underscores and vice versa
            candidate_norm = candidate.replace('_', '-')
            if candidate_norm != candidate and candidate_norm in known_files:
                return [candidate_norm], False

    # 2b. Try to match a directory
    for start in range(len(parts)):
        seg = parts[start:]
        candidate_dir = os.path.join(*seg)
        # Exact match
        matches = [f for f in known_files
                   if os.path.dirname(f) == candidate_dir and f.endswith('.cs')]
        if matches:
            return sorted(matches), False
        # Fuzzy match (hyphen ↔ underscore)
        norm_key = _normalize(candidate_dir)
        if norm_key in norm_dir_map:
            real_dir = norm_dir_map[norm_key]
            matches = [f for f in known_files
                       if os.path.dirname(f) == real_dir and f.endswith('.cs')]
            if matches:
                return sorted(matches), False

    # Could not resolve — treat as external
    return [namespace], True


def _build_graph(directory, hide_system=False, show_c=True, show_h=True,
                 show_cpp=True, show_js=False, show_py=False,
                 show_java=False, show_go=False, show_rust=False,
                 show_cs=False, hide_isolated=False, filter_dir=""):
    """Parse source files and return the dependency graph as a dict.

    Returns a dict with keys ``nodes``, ``edges``, ``has_cycles``, and
    ``cycles``.
    """
    nodes = []
    edges = []
    node_set = set()

    files_to_parse = _collect_source_files(
        directory, show_c, show_h, show_cpp, show_js,
        show_py, show_java, show_go, show_rust, show_cs,
    )

    # Build a set of known relative paths for import resolution
    known_files = {os.path.relpath(fp, directory) for fp in files_to_parse}

    # Pre-read go.mod if Go is enabled
    go_module_path = _parse_go_mod(directory) if show_go else None

    # Pre-scan C# namespace declarations for accurate resolution
    cs_ns_map, cs_class_map = (
        _build_cs_namespace_map(directory, known_files) if show_cs else ({}, {})
    )

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

        is_js_file = filepath.endswith(_JS_EXTENSIONS)
        is_py_file = filepath.endswith(_PY_EXTENSIONS)
        is_java_file = filepath.endswith(_JAVA_EXTENSIONS)
        is_go_file = filepath.endswith(_GO_EXTENSIONS)
        is_rust_file = filepath.endswith(_RUST_EXTENSIONS)
        is_cs_file = filepath.endswith(_CS_EXTENSIONS)

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

        # --- C# using directives ---
        if is_cs_file:
            for m in _CS_USING_RE.finditer(content):
                namespace = m.group(1)
                resolved_list, is_external = _resolve_cs_using(
                    namespace, directory, known_files,
                    ns_map=cs_ns_map, class_map=cs_class_map
                )
                if hide_system and is_external:
                    continue
                for resolved in resolved_list:
                    if resolved != filename:  # skip self-references
                        _add_edge(filename, resolved)
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
                                            show_py, show_java, show_go, show_rust,
                                            show_cs):
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
        "has_cs": False,
    }
    all_keys = set(flags.keys())
    skip_dirs = {'node_modules', '__pycache__', '.venv', 'venv', 'target',
                 'vendor', 'bin', 'obj', 'packages', '.vs'}
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
            if fname.endswith(_CS_EXTENSIONS):
                flags["has_cs"] = True
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
        show_cs = detected["has_cs"]
    elif mode == 'auto':
        show_c = show_h = show_cpp = show_js = True
        show_py = show_java = show_go = show_rust = show_cs = True
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
        "hide_isolated": source.get('hide_isolated', 'false').lower() == 'true',
        "filter_dir": source.get('filter_dir', ''),
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return app.send_static_file('index.html')


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
        with _upload_lock:
            abs_dir = _upload_sessions.get(upload_token)
        if not abs_dir or not os.path.isdir(abs_dir):
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
def detect_languages():
    """Scan a directory and return which language groups are present."""
    directory = request.args.get('dir', '.')

    abs_dir = _validate_directory(directory)
    if abs_dir is None:
        return jsonify({"error": "Directory not found or access denied."}), 400

    return jsonify(_detect_languages(abs_dir))


@app.route('/api/graph', methods=['GET'])
def get_graph():
    directory = request.args.get('dir', '.')

    abs_dir = _validate_directory(directory)
    if abs_dir is None:
        return jsonify({"error": "Directory not found or access denied."}), 400

    detected = _detect_languages(abs_dir)
    filters = _parse_filters(request.args, detected=detected)
    result = _build_graph(abs_dir, **filters)
    result["detected"] = detected
    return jsonify(result)


# Thread-safe tracking of upload temp dirs keyed by an opaque session token.
# Each upload gets a unique token; the previous upload for the same token is
# cleaned up automatically.
_upload_sessions = {}  # token -> temp_dir path
_upload_lock = threading.Lock()


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

    # Generate an opaque upload token for this session
    upload_token = secrets.token_urlsafe(16)

    temp_dir = tempfile.mkdtemp()

    try:
        saved_path = os.path.join(temp_dir, secure_filename(file.filename))
        file.save(saved_path)

        if saved_path.endswith('.zip'):
            _safe_extract_zip(saved_path, temp_dir)

        detected = _detect_languages(temp_dir)
        filters = _parse_filters(request.form, detected=detected)
        result = _build_graph(temp_dir, **filters)
        result["detected"] = detected
        # Return an opaque token — never expose the real filesystem path
        result["upload_token"] = upload_token

        with _upload_lock:
            # Clean up any previous upload for robustness (simple FIFO)
            if len(_upload_sessions) > 50:
                oldest_key = next(iter(_upload_sessions))
                old_dir = _upload_sessions.pop(oldest_key, None)
                if old_dir and os.path.isdir(old_dir):
                    shutil.rmtree(old_dir, ignore_errors=True)
            _upload_sessions[upload_token] = temp_dir

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


@app.route('/api/simulate', methods=['POST'])
def simulate_removal():
    """Simulate removing a node or edge and report what would break.

    Expects JSON: {
        "graph": { ...graph payload... },
        "remove_nodes": ["file_id", ...],   // optional
        "remove_edges": [{"source": "a", "target": "b"}, ...]  // optional
    }

    Returns a report of broken imports, newly disconnected files,
    new cycles introduced/resolved, and metric changes.
    """
    body = request.get_json(force=True)
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

    # --- Broken imports: edges that existed but no longer do ---
    broken_imports = []
    for e in orig_edges:
        s, t = e['data']['source'], e['data']['target']
        if s in remove_nodes:
            continue  # source removed, not a "break" from remaining code's perspective
        if t in remove_nodes:
            # This file still exists but its import target is gone
            broken_imports.append({"file": s, "missing_dep": t, "reason": "target_removed"})
        elif (s, t) in remove_edges:
            broken_imports.append({"file": s, "missing_dep": t, "reason": "edge_removed"})

    # --- Orphaned files: files that had inbound edges but now have zero ---
    newly_orphaned = []
    for nid in new_node_ids:
        had_inbound = len(orig_rev.get(nid, [])) > 0
        now_inbound = len(new_rev.get(nid, []))
        if had_inbound and now_inbound == 0:
            newly_orphaned.append(nid)

    # --- Disconnected subgraphs: files now unreachable from any root ---
    # (roots = files with 0 inbound edges)
    new_roots = [nid for nid in new_node_ids if len(new_rev.get(nid, [])) == 0]
    reachable = set()
    stack = list(new_roots)
    while stack:
        cur = stack.pop()
        if cur in reachable:
            continue
        reachable.add(cur)
        for dep in new_rev.get(cur, []):
            if dep not in reachable:
                stack.append(dep)

    # --- Cycle changes ---
    orig_sccs = _find_sccs(orig_adj)
    orig_cycles = [scc for scc in orig_sccs if len(scc) > 1]

    new_sccs = _find_sccs(new_adj)
    new_cycles = [scc for scc in new_sccs if len(scc) > 1]

    orig_cycle_sets = [frozenset(c) for c in orig_cycles]
    new_cycle_sets = [frozenset(c) for c in new_cycles]

    resolved_cycles = [sorted(list(c)) for c in orig_cycle_sets if c not in new_cycle_sets]
    new_introduced_cycles = [sorted(list(c)) for c in new_cycle_sets if c not in orig_cycle_sets]

    # --- Impact summary: compute new impact scores ---
    impact_changes = []
    for nid in new_node_ids:
        # Original impact
        orig_imp = 0
        for n in orig_nodes:
            if n['data']['id'] == nid:
                orig_imp = n['data'].get('impact', 0)
                break

        # New impact via BFS on new reverse adjacency
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
    """Generate a guided narrative walkthrough of the dependency graph.

    Expects JSON: { "graph": { ...graph payload... } }

    Returns an ordered list of "steps", each with:
        - title, narrative, highlight_nodes, highlight_edges, zoom_target, step_type
    """
    try:
        return _generate_story_impl()
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Story generation failed: {exc}"}), 500


def _generate_story_impl():
    body = request.get_json(force=True)
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

    # ── Step 1: Overview ──
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

    # ── Step 2: Entry Points ──
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

    # ── Step 3: Hub Files (highest in-degree) ──
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

        # Collect edges that touch the top hub
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

    # ── Step 4: Deepest Dependency Chains ──
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

    # ── Step 5: Circular Dependencies ──
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

    # ── Step 6: Stability Risks ──
    # High-impact + unstable files are the riskiest
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

    # ── Step 7: Directory Coupling ──
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

    # ── Step 8: Summary & Recommendations ──
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
