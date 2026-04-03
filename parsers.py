"""Language-specific import/include regex patterns and resolution functions.

Each ``_resolve_*`` function takes an import path (and context like the source
file, project directory, and set of known files) and returns a tuple of
``(resolved_path, is_external)``.
"""

import os
import re

# =========================================================================
# Regex patterns
# =========================================================================

# C/C++: #include <header> or #include "header"
INCLUDE_RE = re.compile(r'#include\s*(<|")([^>"]+)(>|")')

# JS/TS: import ... from 'path', import 'path', require('path')
JS_IMPORT_RE = re.compile(
    r'''(?:import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]'''
    r'''|require\s*\(\s*['"]([^'"]+)['"]\s*\))'''
)

# Python: import foo, import foo.bar, from foo import bar, from . import bar
PY_FROM_IMPORT_RE = re.compile(
    r'^from\s+(\.{0,3}[\w.]*)\s+import\s+(.+)$', re.MULTILINE
)
PY_IMPORT_RE = re.compile(
    r'^import\s+([\w.]+(?:\s*,\s*[\w.]+)*)\s*$', re.MULTILINE
)
# Collapse parenthesised Python imports onto a single line so the regex above
# can match them.  e.g.  from foo import (\n  a,\n  b\n) → from foo import a, b
_PY_MULTILINE_IMPORT_RE = re.compile(
    r'^(from\s+\S+\s+import\s*)\(\s*([^)]*)\)', re.MULTILINE | re.DOTALL
)

# Java: import com.example.Foo; or import static com.example.Foo.bar;
JAVA_IMPORT_RE = re.compile(
    r'^import\s+(?:static\s+)?([\w.*]+)\s*;', re.MULTILINE
)

# Go: import "path" or import ( "path" ... )
GO_IMPORT_RE = re.compile(
    r'import\s+(?:\(\s*((?:[^)]*?))\s*\)|"([^"]+)")', re.DOTALL
)
GO_IMPORT_PATH_RE = re.compile(r'"([^"]+)"')

# Rust: use path::to::thing; pub use re_export; mod foo; extern crate bar;
RUST_USE_RE = re.compile(r'^\s*(?:pub\s+)?use\s+([\w:]+)', re.MULTILINE)
RUST_MOD_RE = re.compile(r'^\s*(?:pub(?:\([\w:]+\))?\s+)?mod\s+(\w+)\s*[;{]', re.MULTILINE)
RUST_EXTERN_RE = re.compile(r'^\s*extern\s+crate\s+(\w+)(?:\s+as\s+\w+)?\s*;', re.MULTILINE)

# C#: using System; using System.Collections.Generic; using static Foo.Bar;
CS_USING_RE = re.compile(
    r'^using\s+(?:static\s+)?([\w.]+)\s*;', re.MULTILINE
)

# C# namespace declaration (for building namespace maps)
CS_NAMESPACE_RE = re.compile(
    r'^\s*namespace\s+([\w.]+)', re.MULTILINE
)

# Swift: import ModuleName, import struct ModuleName.Type, @testable import Foo
SWIFT_IMPORT_RE = re.compile(
    r'^\s*(?:@\w+\s+)?import\s+(?:class\s+|struct\s+|enum\s+|protocol\s+|typealias\s+|func\s+|var\s+|let\s+)?([\w.]+)', re.MULTILINE
)

# Ruby: require 'path', require "path", require_relative 'path', load 'path'
RUBY_REQUIRE_RE = re.compile(
    r'''^\s*(?:require_relative|require|load)\s+['"]([\w.\/\-]+)['"]''', re.MULTILINE
)
RUBY_REQUIRE_RELATIVE_RE = re.compile(
    r'''^\s*require_relative\s+['"]([\w.\/\-]+)['"]''', re.MULTILINE
)


# =========================================================================
# File extension groups
# =========================================================================

C_EXTENSIONS = ('.c',)
H_EXTENSIONS = ('.h',)
CPP_EXTENSIONS = ('.cpp', '.cc', '.cxx', '.hpp', '.hxx')
JS_EXTENSIONS = ('.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx')
PY_EXTENSIONS = ('.py',)
JAVA_EXTENSIONS = ('.java',)
GO_EXTENSIONS = ('.go',)
RUST_EXTENSIONS = ('.rs',)
CS_EXTENSIONS = ('.cs',)
SWIFT_EXTENSIONS = ('.swift',)
RUBY_EXTENSIONS = ('.rb',)


# =========================================================================
# Standard library / system module sets
# =========================================================================

PY_STDLIB = frozenset([
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

CS_SYSTEM_PREFIXES = (
    'System', 'Microsoft', 'Windows', 'Internal', 'Interop',
)

SWIFT_SYSTEM_MODULES = frozenset([
    'Foundation', 'UIKit', 'SwiftUI', 'AppKit', 'Combine', 'CoreData',
    'CoreGraphics', 'CoreLocation', 'CoreMotion', 'MapKit', 'Metal',
    'ObjectiveC', 'os', 'Darwin', 'Dispatch', 'XCTest', 'Swift',
    'AVFoundation', 'ARKit', 'CloudKit', 'Contacts', 'CoreBluetooth',
    'CoreImage', 'CoreML', 'CoreMedia', 'CoreText', 'CoreVideo',
    'CryptoKit', 'EventKit', 'GameKit', 'HealthKit', 'HomeKit',
    'IOKit', 'LocalAuthentication', 'MediaPlayer', 'MessageUI',
    'MultipeerConnectivity', 'NaturalLanguage', 'Network', 'NotificationCenter',
    'PassKit', 'Photos', 'QuartzCore', 'RealityKit', 'SafariServices',
    'SceneKit', 'Security', 'SpriteKit', 'StoreKit', 'SystemConfiguration',
    'UserNotifications', 'Vision', 'WatchKit', 'WebKit', 'WidgetKit',
])

RUBY_STDLIB = frozenset([
    'abbrev', 'base64', 'benchmark', 'bigdecimal', 'cgi', 'csv', 'date',
    'dbm', 'debug', 'delegate', 'digest', 'drb', 'English', 'erb', 'etc',
    'expect', 'fcntl', 'fiddle', 'fileutils', 'find', 'forwardable',
    'gdbm', 'getoptlong', 'io/console', 'io/nonblock', 'io/wait', 'ipaddr',
    'irb', 'json', 'logger', 'matrix', 'minitest', 'monitor', 'mutex_m',
    'net/ftp', 'net/http', 'net/imap', 'net/pop', 'net/smtp', 'nkf',
    'objspace', 'observer', 'open-uri', 'open3', 'openssl', 'optparse',
    'ostruct', 'pathname', 'pp', 'prettyprint', 'prime', 'pstore',
    'psych', 'pty', 'racc', 'rake', 'rdoc', 'readline', 'reline',
    'resolv', 'rinda', 'ripper', 'rss', 'rubygems', 'securerandom',
    'set', 'shellwords', 'singleton', 'socket', 'stringio', 'strscan',
    'syslog', 'tempfile', 'time', 'timeout', 'tmpdir', 'tracer',
    'tsort', 'un', 'uri', 'weakref', 'webrick', 'win32ole', 'yaml', 'zlib',
    'bundler', 'rails', 'active_support', 'active_record', 'action_view',
    'action_controller', 'action_mailer', 'active_model', 'active_job',
    'action_cable', 'action_pack', 'sprockets', 'rack', 'puma', 'thin',
    'sinatra', 'rspec', 'nokogiri', 'httparty', 'faraday', 'devise',
])


# =========================================================================
# Helper functions
# =========================================================================

def collapse_py_multiline_imports(source: str) -> str:
    """Replace parenthesised import lists with single-line equivalents."""
    def _repl(m):
        prefix = m.group(1)             # "from foo import "
        body = m.group(2)               # "a,\n    b,\n    c\n"
        names = ', '.join(
            n.strip() for n in body.replace('\n', ' ').split(',') if n.strip()
        )
        return prefix + names
    return _PY_MULTILINE_IMPORT_RE.sub(_repl, source)


# =========================================================================
# Resolution functions
# =========================================================================

def resolve_js_import(import_path, source_file, directory, known_files):
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
    for ext in JS_EXTENSIONS:
        probe = candidate + ext
        if probe in known_files:
            return probe, False

    # Probe index files (import './foo' → ./foo/index.js)
    for ext in JS_EXTENSIONS:
        probe = os.path.join(candidate, 'index' + ext)
        if probe in known_files:
            return probe, False

    # Return the raw path — may create an "unresolved" node, which is fine
    return candidate, False


def resolve_py_import(module_path, source_file, directory, known_files):
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
        if top_level in PY_STDLIB:
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


def resolve_java_import(import_path, directory, known_files):
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


def parse_go_mod(directory):
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


def resolve_go_import(import_path, directory, known_files, module_path):
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


def resolve_rust_mod(mod_name, source_file, directory, known_files):
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


def build_cs_namespace_map(directory, known_files):
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

        for m in CS_NAMESPACE_RE.finditer(content):
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


def resolve_cs_using(namespace, directory, known_files, ns_map=None,
                     class_map=None):
    """Resolve a C# ``using`` directive to project file(s) if possible.

    C# using directives reference namespaces, not files directly.  Resolution
    proceeds in priority order:

    1. **Namespace map** (most reliable) — match against namespaces actually
       declared in the project's ``.cs`` files.
    2. **Path heuristics** — convert namespace segments to path components.
    3. If nothing matches, the namespace is treated as external.

    Returns ``(list_of_resolved_paths, is_external)``.
    """
    # Check for system/framework namespace
    if namespace.startswith(CS_SYSTEM_PREFIXES):
        return [namespace], True

    # --- Strategy 1: namespace map from actual declarations ---
    if ns_map is not None:
        # Exact namespace match
        if namespace in ns_map:
            return ns_map[namespace], False

        # Try as Namespace.ClassName
        if class_map and namespace in class_map:
            return [class_map[namespace]], False

        # Check if this namespace is a parent of any known namespace
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


def resolve_swift_import(module_name, source_file, directory, known_files):
    """Resolve a Swift import to a local file or mark as external.

    Swift imports reference modules (not files directly).  For local project
    files we try to match the module name to a .swift file or a directory of
    .swift files.

    Returns ``(resolved, is_external)``.
    """
    top_module = module_name.split('.')[0]
    if top_module in SWIFT_SYSTEM_MODULES:
        return module_name, True

    # Try as a .swift file
    candidate = module_name.replace('.', os.sep) + '.swift'
    if candidate in known_files:
        return candidate, False

    # Try as a directory containing .swift files
    dir_path = module_name.replace('.', os.sep)
    matches = [f for f in known_files
               if f.startswith(dir_path + os.sep) and f.endswith('.swift')]
    if matches:
        return dir_path, False

    # Try just the base name
    base = module_name.split('.')[-1] + '.swift'
    for f in known_files:
        if os.path.basename(f) == base:
            return f, False

    return module_name, True


def resolve_ruby_require(req_path, source_file, directory, known_files,
                         relative=False):
    """Resolve a Ruby require/require_relative to a project file.

    Returns ``(resolved, is_external)``.
    """
    if relative:
        source_dir = os.path.dirname(source_file)
        candidate = os.path.normpath(os.path.join(source_dir, req_path))
    else:
        # Check if it's a stdlib/gem
        top = req_path.split('/')[0]
        if top in RUBY_STDLIB:
            return req_path, True
        candidate = req_path

    # Try with .rb extension
    if not candidate.endswith('.rb'):
        candidate_rb = candidate + '.rb'
    else:
        candidate_rb = candidate

    if candidate_rb in known_files:
        return candidate_rb, False

    # Try without extension
    if candidate in known_files:
        return candidate, False

    # For non-relative requires, it's likely a gem
    if not relative:
        return req_path, True

    return candidate_rb, False
