/**
 * Faithful port of Python graph building engine to client-side JavaScript.
 * This module ports all logic from parsers.py and graph.py into a single JS module.
 *
 * Usage:
 *   const result = DepGraphEngine.buildGraph(fileContents, {langFlags, hideSystem, hideIsolated, filterDir});
 */

const DepGraphEngine = (function() {
    'use strict';

    // =========================================================================
    // Path utilities (replaces os.path functions)
    // =========================================================================

    function pathJoin(...parts) {
        return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
    }

    function normPath(p) {
        const parts = p.split('/');
        const out = [];
        for (const part of parts) {
            if (part === '.' || part === '') continue;
            if (part === '..' && out.length && out[out.length - 1] !== '..') {
                out.pop();
            } else if (part !== '..' && part !== '.') {
                out.push(part);
            }
        }
        return out.join('/') || '.';
    }

    function pathDirname(p) {
        const i = p.lastIndexOf('/');
        return i < 0 ? '' : p.substring(0, i);
    }

    function pathBasename(p) {
        const i = p.lastIndexOf('/');
        return i < 0 ? p : p.substring(i + 1);
    }

    function pathSplitExt(p) {
        const base = pathBasename(p);
        const i = base.lastIndexOf('.');
        if (i <= 0) return [p, ''];
        return [p.substring(0, p.length - (base.length - i)), base.substring(i)];
    }

    // =========================================================================
    // Regex patterns (ported from parsers.py)
    // =========================================================================

    // NOTE: All regexes that are used with matchAll() need the 'g' flag.
    // Regexes used line-by-line (INCLUDE_RE, JS_IMPORT_RE) don't need 'g'.

    const INCLUDE_RE = /#include\s*(<|")([^>"]+)(>|")/;  // used per-line, no 'g'

    const JS_IMPORT_RE = /(?:import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/;  // used per-line

    const PY_FROM_IMPORT_RE = /^from\s+(\.{0,3}[\w.]*)\s+import\s+(.+)$/gm;
    const PY_IMPORT_RE = /^import\s+([\w.]+(?:\s*,\s*[\w.]+)*)\s*$/gm;
    const _PY_MULTILINE_IMPORT_RE = /^(from\s+\S+\s+import\s*)\(\s*([^)]*)\)/gms;

    const JAVA_IMPORT_RE = /^import\s+(?:static\s+)?([\w.*]+)\s*;/gm;

    const GO_IMPORT_RE = /import\s+(?:\(\s*((?:[^)]*?))\s*\)|"([^"]+)")/gs;
    const GO_IMPORT_PATH_RE = /"([^"]+)"/g;

    const RUST_USE_RE = /^\s*(?:pub\s+)?use\s+([\w:]+)/gm;
    const RUST_MOD_RE = /^\s*(?:pub(?:\([\w:]+\))?\s+)?mod\s+(\w+)\s*[;{]/gm;
    const RUST_EXTERN_RE = /^\s*extern\s+crate\s+(\w+)(?:\s+as\s+\w+)?\s*;/gm;

    const CS_USING_RE = /^using\s+(?:static\s+)?([\w.]+)\s*;/gm;
    const CS_NAMESPACE_RE = /^\s*namespace\s+([\w.]+)/gm;

    const SWIFT_IMPORT_RE = /^\s*(?:@\w+\s+)?import\s+(?:class\s+|struct\s+|enum\s+|protocol\s+|typealias\s+|func\s+|var\s+|let\s+)?([\w.]+)/gm;

    const RUBY_REQUIRE_RE = /^\s*(?:require_relative|require|load)\s+['"]([\w.\/\-]+)['"]/gm;
    const RUBY_REQUIRE_RELATIVE_RE = /^\s*require_relative\s+['"]([\w.\/\-]+)['"]/gm;

    const KOTLIN_IMPORT_RE = /^import\s+([\w.*]+)(?:\s+as\s+\w+)?\s*$/gm;

    const SCALA_IMPORT_RE = /^import\s+([\w.*]+(?:\.\{[^}]+\})?)\s*$/gm;

    const PHP_USE_RE = /^\s*use\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm;
    const PHP_REQUIRE_RE = /^\s*(?:require_once|include_once|require|include)\s*[\(]?\s*['"]([\w.\/\-]+)['"]\s*[\)]?\s*;/gm;
    const PHP_NAMESPACE_RE = /^\s*namespace\s+([\w\\]+)\s*;/gm;

    const DART_IMPORT_RE = /^\s*import\s+['"]([\w:\/.\-]+)['"]\s*(?:as\s+\w+\s*)?(?:show\s+[\w,\s]+)?(?:hide\s+[\w,\s]+)?;/gm;

    const ELIXIR_ALIAS_RE = /^\s*(?:alias|import|use|require)\s+([\w.]+)/gm;

    const LUA_REQUIRE_RE = /require\s*[\(]?\s*['"]([^'"]+)['"]\s*[\)]?/gm;

    const ZIG_IMPORT_RE = /@import\s*\(\s*"([^"]+)"\s*\)/gm;

    const HASKELL_IMPORT_RE = /^\s*import\s+(?:qualified\s+)?([\w.]+)/gm;

    const R_LIBRARY_RE = /^\s*(?:library|require)\s*\(\s*(?:['"]?([\w.]+)['"]?)\s*\)/gm;
    const R_SOURCE_RE = /^\s*source\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

    // =========================================================================
    // File extension groups
    // =========================================================================

    const C_EXTENSIONS = ['.c'];
    const H_EXTENSIONS = ['.h'];
    const CPP_EXTENSIONS = ['.cpp', '.cc', '.cxx', '.hpp', '.hxx'];
    const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];
    const PY_EXTENSIONS = ['.py'];
    const JAVA_EXTENSIONS = ['.java'];
    const GO_EXTENSIONS = ['.go'];
    const RUST_EXTENSIONS = ['.rs'];
    const CS_EXTENSIONS = ['.cs'];
    const SWIFT_EXTENSIONS = ['.swift'];
    const RUBY_EXTENSIONS = ['.rb'];
    const KOTLIN_EXTENSIONS = ['.kt', '.kts'];
    const SCALA_EXTENSIONS = ['.scala', '.sc'];
    const PHP_EXTENSIONS = ['.php'];
    const DART_EXTENSIONS = ['.dart'];
    const ELIXIR_EXTENSIONS = ['.ex', '.exs'];
    const LUA_EXTENSIONS = ['.lua'];
    const ZIG_EXTENSIONS = ['.zig'];
    const HASKELL_EXTENSIONS = ['.hs'];
    const R_EXTENSIONS = ['.R', '.r'];

    // =========================================================================
    // Standard library / system module sets
    // =========================================================================

    const PY_STDLIB = new Set([
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
    ]);

    const CS_SYSTEM_PREFIXES = [
        'System', 'Microsoft', 'Windows', 'Internal', 'Interop',
    ];

    const SWIFT_SYSTEM_MODULES = new Set([
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
    ]);

    const KOTLIN_STDLIB_PREFIXES = [
        'kotlin', 'java', 'javax', 'android', 'androidx', 'org.jetbrains',
        'kotlinx',
    ];

    const SCALA_STDLIB_PREFIXES = [
        'scala', 'java', 'javax', 'akka', 'play',
    ];

    const PHP_SYSTEM_PREFIXES = [
        'Illuminate', 'Symfony', 'Psr', 'Doctrine', 'GuzzleHttp',
        'Monolog', 'Carbon', 'PHPUnit', 'Composer',
    ];

    const DART_SYSTEM_PREFIXES = [
        'dart:', 'package:flutter',
    ];

    const ELIXIR_STDLIB = new Set([
        'Kernel', 'Enum', 'List', 'Map', 'String', 'IO', 'File', 'Path',
        'Agent', 'Task', 'GenServer', 'Supervisor', 'Application',
        'Logger', 'Inspect', 'Protocol', 'Stream', 'Range', 'Regex',
        'Tuple', 'Keyword', 'Access', 'Macro', 'Module', 'Process',
        'Port', 'System', 'Code', 'ETS', 'Node', 'Atom', 'Integer',
        'Float', 'Function', 'Exception', 'Collectable', 'Enumerable',
        'MapSet', 'HashSet', 'HashDict', 'Set', 'Dict', 'Base',
        'Bitwise', 'Record', 'URI', 'Calendar', 'Date', 'DateTime',
        'Time', 'NaiveDateTime', 'Version', 'Behaviour', 'GenEvent',
        'ExUnit', 'Mix', 'IEx', 'EEx', 'Plug', 'Phoenix', 'Ecto',
    ]);

    const RUBY_STDLIB = new Set([
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
    ]);

    const LUA_STDLIB = new Set([
        'coroutine', 'debug', 'io', 'math', 'os', 'package', 'string',
        'table', 'utf8', 'bit32', 'bit',
        'lfs', 'socket', 'ssl', 'mime', 'ltn12', 'lpeg', 'cjson',
        'love', 'love.audio', 'love.data', 'love.event', 'love.filesystem',
        'love.font', 'love.graphics', 'love.image', 'love.joystick',
        'love.keyboard', 'love.math', 'love.mouse', 'love.physics',
        'love.sound', 'love.system', 'love.thread', 'love.timer',
        'love.touch', 'love.video', 'love.window',
    ]);

    const ZIG_STDLIB = new Set([
        'std', 'builtin',
    ]);

    const HASKELL_STDLIB = new Set([
        'Prelude', 'Control.Applicative', 'Control.Arrow', 'Control.Category',
        'Control.Concurrent', 'Control.Exception', 'Control.Monad',
        'Control.Monad.IO.Class', 'Control.Monad.Fix', 'Control.Monad.Fail',
        'Control.Monad.ST', 'Control.Monad.Zip',
        'Data.Bits', 'Data.Bool', 'Data.Char', 'Data.Complex', 'Data.Data',
        'Data.Dynamic', 'Data.Either', 'Data.Eq', 'Data.Fixed', 'Data.Foldable',
        'Data.Function', 'Data.Functor', 'Data.IORef', 'Data.Int', 'Data.Ix',
        'Data.Kind', 'Data.List', 'Data.Map', 'Data.Maybe', 'Data.Monoid',
        'Data.Ord', 'Data.Proxy', 'Data.Ratio', 'Data.STRef', 'Data.Semigroup',
        'Data.Sequence', 'Data.Set', 'Data.String', 'Data.Traversable',
        'Data.Tuple', 'Data.Typeable', 'Data.Unique', 'Data.Void', 'Data.Word',
        'Data.ByteString', 'Data.Text', 'Data.Map.Strict', 'Data.Map.Lazy',
        'Data.IntMap', 'Data.IntSet', 'Data.HashMap.Strict', 'Data.HashSet',
        'Data.Vector', 'Data.Aeson', 'Data.Time',
        'Debug.Trace',
        'Foreign', 'Foreign.C', 'Foreign.Marshal', 'Foreign.Ptr',
        'Foreign.StablePtr', 'Foreign.Storable',
        'GHC.Base', 'GHC.Generics', 'GHC.IO', 'GHC.TypeLits',
        'Numeric', 'Numeric.Natural',
        'System.Directory', 'System.Environment', 'System.Exit', 'System.IO',
        'System.Info', 'System.Mem', 'System.Posix', 'System.Process',
        'System.Random', 'System.Timeout',
        'Text.ParserCombinators.ReadP', 'Text.Printf', 'Text.Read',
        'Text.Show', 'Text.Megaparsec', 'Text.Parsec',
        'Network.HTTP', 'Network.Socket', 'Network.URI',
        'Test.HUnit', 'Test.QuickCheck', 'Test.Hspec',
    ]);

    const HASKELL_STDLIB_PREFIXES = [
        'Control.', 'Data.', 'Debug.', 'Foreign.', 'GHC.', 'Numeric.',
        'System.', 'Text.', 'Network.', 'Test.',
    ];

    const R_STDLIB = new Set([
        'base', 'compiler', 'datasets', 'grDevices', 'graphics', 'grid',
        'methods', 'parallel', 'splines', 'stats', 'stats4', 'tcltk',
        'tools', 'utils',
        'ggplot2', 'dplyr', 'tidyr', 'readr', 'purrr', 'tibble', 'stringr',
        'forcats', 'lubridate', 'tidyverse', 'shiny', 'knitr', 'rmarkdown',
        'devtools', 'testthat', 'roxygen2', 'magrittr', 'rlang', 'glue',
        'httr', 'jsonlite', 'xml2', 'rvest', 'plyr', 'reshape2', 'data.table',
        'caret', 'randomForest', 'xgboost', 'e1071', 'MASS', 'lattice',
        'survival', 'nlme', 'lme4', 'Matrix',
    ]);

    // =========================================================================
    // Palette and colors
    // =========================================================================

    const _PALETTE = [
        "#6366f1", "#818cf8", "#8b5cf6", "#7c3aed", "#6d28d9",
        "#3b82f6", "#60a5fa", "#0ea5e9", "#06b6d4", "#14b8a6",
        "#0d9488", "#475569", "#64748b", "#7dd3fc", "#a78bfa",
        "#38bdf8", "#2dd4bf", "#a5b4fc", "#94a3b8", "#5eead4",
    ];

    const LANGUAGE_COLORS = {
        "c":       "#555555",
        "h":       "#6e6e6e",
        "cpp":     "#00599c",
        "js":      "#f7df1e",
        "py":      "#3776ab",
        "java":    "#e76f00",
        "go":      "#00add8",
        "rust":    "#ce422b",
        "cs":      "#68217a",
        "swift":   "#f05138",
        "ruby":    "#cc342d",
        "kotlin":  "#7f52ff",
        "scala":   "#dc322f",
        "php":     "#777bb4",
        "dart":    "#0175c2",
        "elixir":  "#6e4a7e",
        "lua":     "#000080",
        "zig":     "#f7a41d",
        "haskell": "#5e5086",
        "r":       "#276dc3",
    };

    const RISK_COLORS = {
        "critical": "#ef4444", "high": "#f97316", "warning": "#eab308",
        "normal": "#3b82f6", "entry": "#22c55e", "system": "#6b7280",
    };

    const RISK_LABELS = {
        "critical": "Critical / God file", "high": "High influence",
        "warning": "High dependency", "normal": "Normal",
        "entry": "Entry point / leaf", "system": "System / external",
    };

    // =========================================================================
    // Language extension table
    // =========================================================================

    const LANG_EXTENSION_TABLE = [
        ["show_c",       C_EXTENSIONS],
        ["show_h",       H_EXTENSIONS],
        ["show_cpp",     CPP_EXTENSIONS],
        ["show_js",      JS_EXTENSIONS],
        ["show_py",      PY_EXTENSIONS],
        ["show_java",    JAVA_EXTENSIONS],
        ["show_go",      GO_EXTENSIONS],
        ["show_rust",    RUST_EXTENSIONS],
        ["show_cs",      CS_EXTENSIONS],
        ["show_swift",   SWIFT_EXTENSIONS],
        ["show_ruby",    RUBY_EXTENSIONS],
        ["show_kotlin",  KOTLIN_EXTENSIONS],
        ["show_scala",   SCALA_EXTENSIONS],
        ["show_php",     PHP_EXTENSIONS],
        ["show_dart",    DART_EXTENSIONS],
        ["show_elixir",  ELIXIR_EXTENSIONS],
        ["show_lua",     LUA_EXTENSIONS],
        ["show_zig",     ZIG_EXTENSIONS],
        ["show_haskell", HASKELL_EXTENSIONS],
        ["show_r",       R_EXTENSIONS],
    ];

    const LANG_SKIP_DIRS = {
        "show_js":     new Set(['node_modules']),
        "show_py":     new Set(['__pycache__', '.venv', 'venv', '.tox', '.eggs']),
        "show_go":     new Set(['vendor']),
        "show_rust":   new Set(['target']),
        "show_cs":     new Set(['bin', 'obj', 'packages', '.vs']),
        "show_ruby":   new Set(['vendor', '.bundle']),
        "show_kotlin": new Set(['build']),
        "show_scala":  new Set(['target', '.bsp', '.metals']),
        "show_php":    new Set(['vendor']),
        "show_dart":   new Set(['.dart_tool', 'build', '.pub-cache']),
        "show_elixir": new Set(['_build', 'deps', '.elixir_ls']),
        "show_lua":    new Set(['luarocks', '.luarocks']),
        "show_zig":    new Set(['zig-cache', 'zig-out']),
        "show_haskell": new Set(['.stack-work', 'dist-newstyle', 'dist', '.cabal-sandbox']),
        "show_r":      new Set(['renv', 'packrat']),
    };

    // Build extension to language mapping
    const _EXT_TO_LANG = {};
    for (const [flag, exts] of LANG_EXTENSION_TABLE) {
        const lang = flag.substring('show_'.length);
        for (const ext of exts) {
            _EXT_TO_LANG[ext] = lang;
        }
    }

    // =========================================================================
    // Helper functions
    // =========================================================================

    function simpleHash(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) - h + str.charCodeAt(i)) | 0;
        }
        return Math.abs(h);
    }

    function collapsePyMultilineImports(source) {
        return source.replace(_PY_MULTILINE_IMPORT_RE, (match, prefix, body) => {
            const names = body
                .replace(/\n/g, ' ')
                .split(',')
                .map(n => n.trim())
                .filter(n => n)
                .join(', ');
            return prefix + names;
        });
    }

    function langForPath(filepath) {
        const [, ext] = pathSplitExt(filepath);
        return _EXT_TO_LANG[ext] || null;
    }

    function dirColor(filepath) {
        const dirname = pathDirname(filepath) || '.';
        const hashVal = simpleHash(dirname);
        return _PALETTE[hashVal % _PALETTE.length];
    }

    function colorForPath(filepath) {
        return dirColor(filepath);
    }

    function shouldSkipDir(name) {
        const lower = name.toLowerCase();
        return lower.startsWith('test') || lower.includes('test') || lower.includes('cmake');
    }

    function shouldSkipFile(name) {
        const lower = name.toLowerCase();
        return lower.includes('test') || lower.includes('cmake');
    }

    function wantedExtension(filename, langFlags) {
        for (const [flag, exts] of LANG_EXTENSION_TABLE) {
            if (langFlags[flag]) {
                for (const ext of exts) {
                    if (filename.endsWith(ext)) return true;
                }
            }
        }
        return false;
    }

    function includeTargetExcluded(filename, langFlags) {
        for (const [flag, exts] of LANG_EXTENSION_TABLE) {
            for (const ext of exts) {
                if (filename.endsWith(ext) && !langFlags[flag]) {
                    return true;
                }
            }
        }
        return false;
    }

    // =========================================================================
    // Resolution cache
    // =========================================================================

    class ResolutionCache {
        constructor() {
            this._store = new Map();
        }

        get(resolver, importPath, sourceFile = null) {
            return this._store.get(`${resolver}\0${importPath}\0${sourceFile}`);
        }

        put(resolver, importPath, sourceFile, value) {
            this._store.set(`${resolver}\0${importPath}\0${sourceFile}`, value);
        }

        clear() {
            this._store.clear();
        }

        get size() {
            return this._store.size;
        }
    }

    // =========================================================================
    // Resolution functions
    // =========================================================================

    function resolveJsImport(importPath, sourceFile, directory, knownFiles) {
        if (!importPath.startsWith('.')) {
            return [importPath, true];
        }

        const sourceDir = pathDirname(sourceFile);
        let candidate = normPath(pathJoin(sourceDir, importPath));

        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        for (const ext of JS_EXTENSIONS) {
            const probe = candidate + ext;
            if (knownFiles.has(probe)) {
                return [probe, false];
            }
        }

        for (const ext of JS_EXTENSIONS) {
            const probe = pathJoin(candidate, 'index' + ext);
            if (knownFiles.has(probe)) {
                return [probe, false];
            }
        }

        return [candidate, false];
    }

    function resolvePyImport(modulePath, sourceFile, directory, knownFiles) {
        const isRelative = modulePath.startsWith('.');

        if (isRelative) {
            const dots = modulePath.match(/^\.*/)[0].length;

            const remainder = modulePath.substring(dots);
            const sourceDir = pathDirname(sourceFile);
            let base = sourceDir;
            for (let i = 0; i < dots - 1; i++) {
                base = pathDirname(base);
            }
            const parts = remainder ? remainder.split('.') : [];
            const candidateDir = parts.length ? pathJoin(base, ...parts) : base;

            let candidateFile = candidateDir + '.py';
            if (knownFiles.has(candidateFile)) {
                return [candidateFile, false];
            }

            candidateFile = pathJoin(candidateDir, '__init__.py');
            if (knownFiles.has(candidateFile)) {
                return [candidateFile, false];
            }

            return [candidateDir + '.py', false];
        } else {
            const topLevel = modulePath.split('.')[0];
            if (PY_STDLIB.has(topLevel)) {
                return [modulePath, true];
            }
            const parts = modulePath.split('.');
            const candidateDir = pathJoin(...parts);

            let candidateFile = candidateDir + '.py';
            if (knownFiles.has(candidateFile)) {
                return [candidateFile, false];
            }

            candidateFile = pathJoin(candidateDir, '__init__.py');
            if (knownFiles.has(candidateFile)) {
                return [candidateFile, false];
            }

            return [modulePath, true];
        }
    }

    function resolveJavaImport(importPath, directory, knownFiles) {
        const isWildcard = importPath.endsWith('.*');
        if (isWildcard) {
            const pkg = importPath.substring(0, importPath.length - 2).replace(/\./g, '/');
            const matches = [];
            for (const f of knownFiles) {
                if (f.startsWith(pkg + '/') && f.endsWith('.java')) {
                    const rest = f.substring(pkg.length + 1);
                    if (!rest.includes('/')) {
                        matches.push([f, false]);
                    }
                }
            }
            if (matches.length > 0) return matches;
            return [[importPath, true]];
        } else {
            const candidate = importPath.replace(/\./g, '/') + '.java';
            if (knownFiles.has(candidate)) {
                return [[candidate, false]];
            }
            return [[importPath, true]];
        }
    }

    function parseGoMod(content) {
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('module ')) {
                return trimmed.substring('module '.length).trim();
            }
        }
        return null;
    }

    function resolveGoImport(importPath, directory, knownFiles, modulePath) {
        if (modulePath && importPath.startsWith(modulePath)) {
            let rel = importPath.substring(modulePath.length);
            if (rel.startsWith('/')) rel = rel.substring(1);
            for (const f of knownFiles) {
                if (f.startsWith(rel + '/')) {
                    return [rel, false];
                }
            }
            return [importPath, true];
        }
        if (!importPath.split('/')[0].includes('.')) {
            return [importPath, true];
        }
        return [importPath, true];
    }

    function resolveRustMod(modName, sourceFile, directory, knownFiles) {
        const sourceDir = pathDirname(sourceFile);
        let candidate = pathJoin(sourceDir, modName + '.rs');
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }
        candidate = pathJoin(sourceDir, modName, 'mod.rs');
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }
        return [pathJoin(sourceDir, modName + '.rs'), false];
    }

    function buildCsNamespaceMap(fileContents) {
        const nsMap = {};
        const classMap = {};

        for (const [relPath, content] of fileContents) {
            if (!relPath.endsWith('.cs')) continue;

            for (const m of content.matchAll(CS_NAMESPACE_RE)) {
                const ns = m[1];
                if (!nsMap[ns]) nsMap[ns] = [];
                if (!nsMap[ns].includes(relPath)) {
                    nsMap[ns].push(relPath);
                }

                const basename = pathSplitExt(pathBasename(relPath))[0];
                const classKey = ns + '.' + basename;
                classMap[classKey] = relPath;
            }
        }

        for (const ns in nsMap) {
            nsMap[ns].sort();
        }

        return [nsMap, classMap];
    }

    function resolveCsUsing(namespace, directory, knownFiles, nsMap = null, classMap = null) {
        for (const prefix of CS_SYSTEM_PREFIXES) {
            if (namespace.startsWith(prefix)) {
                return [[namespace], true];
            }
        }

        if (nsMap) {
            if (nsMap[namespace]) {
                return [nsMap[namespace], false];
            }

            if (classMap && classMap[namespace]) {
                return [[classMap[namespace]], false];
            }

            const prefix = namespace + '.';
            const children = [];
            for (const ns in nsMap) {
                if (ns.startsWith(prefix) || ns === namespace) {
                    children.push(...nsMap[ns]);
                }
            }
            if (children.length > 0) {
                return [Array.from(new Set(children)).sort(), false];
            }
        }

        const parts = namespace.split('.');

        function normalize(s) {
            return s.toLowerCase().replace(/-/g, '_');
        }

        const normDirMap = {};
        for (const f of knownFiles) {
            const d = pathDirname(f);
            if (d) {
                normDirMap[normalize(d)] = d;
            }
        }

        for (let start = 0; start < parts.length; start++) {
            for (let end = parts.length; end > start; end--) {
                const seg = parts.slice(start, end);
                let candidate = pathJoin(...seg) + '.cs';
                if (knownFiles.has(candidate)) {
                    return [[candidate], false];
                }
                const candidateNorm = candidate.replace(/_/g, '-');
                if (candidateNorm !== candidate && knownFiles.has(candidateNorm)) {
                    return [[candidateNorm], false];
                }
            }
        }

        for (let start = 0; start < parts.length; start++) {
            const seg = parts.slice(start);
            const candidateDir = pathJoin(...seg);
            const matches = [];
            for (const f of knownFiles) {
                if (pathDirname(f) === candidateDir && f.endsWith('.cs')) {
                    matches.push(f);
                }
            }
            if (matches.length > 0) {
                return [matches.sort(), false];
            }

            const normKey = normalize(candidateDir);
            if (normKey in normDirMap) {
                const realDir = normDirMap[normKey];
                const matches2 = [];
                for (const f of knownFiles) {
                    if (pathDirname(f) === realDir && f.endsWith('.cs')) {
                        matches2.push(f);
                    }
                }
                if (matches2.length > 0) {
                    return [matches2.sort(), false];
                }
            }
        }

        return [[namespace], true];
    }

    function resolveSwiftImport(moduleName, sourceFile, directory, knownFiles) {
        const topModule = moduleName.split('.')[0];
        if (SWIFT_SYSTEM_MODULES.has(topModule)) {
            return [moduleName, true];
        }

        let candidate = moduleName.replace(/\./g, '/') + '.swift';
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        const dirPath = moduleName.replace(/\./g, '/');
        for (const f of knownFiles) {
            if (f.startsWith(dirPath + '/') && f.endsWith('.swift')) {
                return [dirPath, false];
            }
        }

        const base = moduleName.split('.').pop() + '.swift';
        for (const f of knownFiles) {
            if (pathBasename(f) === base) {
                return [f, false];
            }
        }

        return [moduleName, true];
    }

    function resolveRubyRequire(reqPath, sourceFile, directory, knownFiles, relative = false) {
        let candidate;
        if (relative) {
            const sourceDir = pathDirname(sourceFile);
            candidate = normPath(pathJoin(sourceDir, reqPath));
        } else {
            const top = reqPath.split('/')[0];
            if (RUBY_STDLIB.has(top)) {
                return [reqPath, true];
            }
            candidate = reqPath;
        }

        const candidateRb = candidate.endsWith('.rb') ? candidate : candidate + '.rb';
        if (knownFiles.has(candidateRb)) {
            return [candidateRb, false];
        }

        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        if (!relative) {
            return [reqPath, true];
        }

        return [candidateRb, false];
    }

    function resolveKotlinImport(importPath, directory, knownFiles) {
        for (const prefix of KOTLIN_STDLIB_PREFIXES) {
            if (importPath.startsWith(prefix)) {
                return [importPath, true];
            }
        }

        const isWildcard = importPath.endsWith('.*');
        if (isWildcard) {
            const pkg = importPath.substring(0, importPath.length - 2).replace(/\./g, '/');
            const matches = [];
            for (const f of knownFiles) {
                if (f.startsWith(pkg + '/') && (f.endsWith('.kt') || f.endsWith('.kts'))) {
                    const rest = f.substring(pkg.length + 1);
                    if (!rest.includes('/')) {
                        matches.push(f);
                    }
                }
            }
            if (matches.length > 0) {
                return [matches[0], false];
            }
            return [importPath, true];
        }

        let candidate = importPath.replace(/\./g, '/') + '.kt';
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        candidate = importPath.replace(/\./g, '/') + '.kts';
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        const parts = importPath.split('.');
        if (parts.length >= 2) {
            const parentPath = parts.slice(0, -1).join('/') + '.kt';
            if (knownFiles.has(parentPath)) {
                return [parentPath, false];
            }
        }

        return [importPath, true];
    }

    function resolveScalaImport(importPath, directory, knownFiles) {
        let basePath = importPath;
        if (importPath.includes('.{')) {
            basePath = importPath.substring(0, importPath.indexOf('.{'));
        }

        for (const prefix of SCALA_STDLIB_PREFIXES) {
            if (basePath.startsWith(prefix)) {
                return [importPath, true];
            }
        }

        const isWildcard = basePath.endsWith('._');
        if (isWildcard) {
            basePath = basePath.substring(0, basePath.length - 2);
        }

        let candidate = basePath.replace(/\./g, '/') + '.scala';
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        candidate = basePath.replace(/\./g, '/') + '.sc';
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        const pkgObj = pathJoin(basePath.replace(/\./g, '/'), 'package.scala');
        if (knownFiles.has(pkgObj)) {
            return [pkgObj, false];
        }

        const parts = basePath.split('.');
        if (parts.length >= 2) {
            const parentPath = parts.slice(0, -1).join('/') + '.scala';
            if (knownFiles.has(parentPath)) {
                return [parentPath, false];
            }
        }

        return [importPath, true];
    }

    function buildPhpNamespaceMap(fileContents) {
        const nsMap = {};
        const classMap = {};

        for (const [relPath, content] of fileContents) {
            if (!relPath.endsWith('.php')) continue;

            for (const m of content.matchAll(PHP_NAMESPACE_RE)) {
                const ns = m[1];
                if (!nsMap[ns]) nsMap[ns] = [];
                if (!nsMap[ns].includes(relPath)) {
                    nsMap[ns].push(relPath);
                }

                const basename = pathSplitExt(pathBasename(relPath))[0];
                const classKey = ns + '\\' + basename;
                classMap[classKey] = relPath;
            }
        }

        for (const ns in nsMap) {
            nsMap[ns].sort();
        }

        return [nsMap, classMap];
    }

    function resolvePhpUse(namespace, directory, knownFiles, nsMap = null, classMap = null) {
        for (const prefix of PHP_SYSTEM_PREFIXES) {
            if (namespace.startsWith(prefix)) {
                return [namespace, true];
            }
        }

        if (classMap && classMap[namespace]) {
            return [classMap[namespace], false];
        }

        if (nsMap) {
            if (nsMap[namespace]) {
                const files = nsMap[namespace];
                if (files.length > 0) {
                    return [files[0], false];
                }
            }

            const prefix = namespace + '\\';
            const children = [];
            for (const ns in nsMap) {
                if (ns.startsWith(prefix) || ns === namespace) {
                    children.push(...nsMap[ns]);
                }
            }
            if (children.length > 0) {
                return [Array.from(new Set(children)).sort()[0], false];
            }
        }

        const candidate = namespace.replace(/\\/g, '/') + '.php';
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        const parts = namespace.split('\\');
        for (let start = 0; start < parts.length; start++) {
            const candidate2 = pathJoin(...parts.slice(start)) + '.php';
            if (knownFiles.has(candidate2)) {
                return [candidate2, false];
            }
        }

        return [namespace, true];
    }

    function resolvePhpRequire(reqPath, sourceFile, directory, knownFiles) {
        const sourceDir = pathDirname(sourceFile);
        let candidate = normPath(pathJoin(sourceDir, reqPath));

        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        if (knownFiles.has(reqPath)) {
            return [reqPath, false];
        }

        return [candidate, false];
    }

    function resolveDartImport(importPath, sourceFile, directory, knownFiles) {
        if (importPath.startsWith('dart:')) {
            return [importPath, true];
        }

        if (importPath.startsWith('package:')) {
            const parts = importPath.substring('package:'.length).split('/', 1);
            if (parts.length === 2) {
                const [pkgName, rest] = parts;
                const candidate = pathJoin('lib', rest);
                if (knownFiles.has(candidate)) {
                    return [candidate, false];
                }
            }
            for (const prefix of DART_SYSTEM_PREFIXES) {
                if (importPath.startsWith(prefix)) {
                    return [importPath, true];
                }
            }
            return [importPath, true];
        }

        const sourceDir = pathDirname(sourceFile);
        let candidate = normPath(pathJoin(sourceDir, importPath));
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        if (knownFiles.has(importPath)) {
            return [importPath, false];
        }

        return [candidate, false];
    }

    function resolveElixirModule(moduleName, sourceFile, directory, knownFiles) {
        const topModule = moduleName.split('.')[0];
        if (ELIXIR_STDLIB.has(topModule)) {
            return [moduleName, true];
        }

        const parts = moduleName.split('.');
        const snakeParts = [];
        for (const part of parts) {
            let snake = '';
            for (let i = 0; i < part.length; i++) {
                const ch = part[i];
                if (ch === ch.toUpperCase() && i > 0 && part[i - 1] === part[i - 1].toLowerCase()) {
                    snake += '_';
                }
                snake += ch.toLowerCase();
            }
            snakeParts.push(snake);
        }

        let candidate = pathJoin('lib', ...snakeParts) + '.ex';
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        candidate = pathJoin('lib', ...snakeParts) + '.exs';
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        candidate = pathJoin(...snakeParts) + '.ex';
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        candidate = pathJoin(...snakeParts) + '.exs';
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        const base = snakeParts[snakeParts.length - 1];
        for (const f of knownFiles) {
            const fname = pathSplitExt(pathBasename(f))[0];
            if (fname === base && (f.endsWith('.ex') || f.endsWith('.exs'))) {
                return [f, false];
            }
        }

        return [moduleName, true];
    }

    function resolveLuaRequire(reqPath, sourceFile, directory, knownFiles) {
        const top = reqPath.split('.')[0];
        if (LUA_STDLIB.has(top) || LUA_STDLIB.has(reqPath)) {
            return [reqPath, true];
        }

        let candidate = reqPath.replace(/\./g, '/') + '.lua';
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        const initCandidate = pathJoin(reqPath.replace(/\./g, '/'), 'init.lua');
        if (knownFiles.has(initCandidate)) {
            return [initCandidate, false];
        }

        const sourceDir = pathDirname(sourceFile);
        const relCandidate = normPath(pathJoin(sourceDir, candidate));
        if (knownFiles.has(relCandidate)) {
            return [relCandidate, false];
        }

        const bare = reqPath + '.lua';
        if (knownFiles.has(bare)) {
            return [bare, false];
        }

        return [reqPath, true];
    }

    function resolveZigImport(importPath, sourceFile, directory, knownFiles) {
        if (ZIG_STDLIB.has(importPath)) {
            return [importPath, true];
        }

        const sourceDir = pathDirname(sourceFile);
        let candidate = normPath(pathJoin(sourceDir, importPath));
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        if (knownFiles.has(importPath)) {
            return [importPath, false];
        }

        if (!importPath.endsWith('.zig')) {
            let probe = candidate + '.zig';
            if (knownFiles.has(probe)) {
                return [probe, false];
            }
            probe = importPath + '.zig';
            if (knownFiles.has(probe)) {
                return [probe, false];
            }
        }

        return [importPath, true];
    }

    function resolveHaskellImport(moduleName, sourceFile, directory, knownFiles) {
        if (HASKELL_STDLIB.has(moduleName)) {
            return [moduleName, true];
        }

        for (const prefix of HASKELL_STDLIB_PREFIXES) {
            if (moduleName.startsWith(prefix)) {
                return [moduleName, true];
            }
        }

        if (moduleName === 'Prelude') {
            return [moduleName, true];
        }

        let candidate = moduleName.replace(/\./g, '/') + '.hs';
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        let srcCandidate = pathJoin('src', candidate);
        if (knownFiles.has(srcCandidate)) {
            return [srcCandidate, false];
        }

        let libCandidate = pathJoin('lib', candidate);
        if (knownFiles.has(libCandidate)) {
            return [libCandidate, false];
        }

        let appCandidate = pathJoin('app', candidate);
        if (knownFiles.has(appCandidate)) {
            return [appCandidate, false];
        }

        const base = moduleName.split('.').pop() + '.hs';
        for (const f of knownFiles) {
            if (pathBasename(f) === base) {
                return [f, false];
            }
        }

        return [moduleName, true];
    }

    function resolveRSource(sourcePath, sourceFile, directory, knownFiles) {
        const sourceDir = pathDirname(sourceFile);
        let candidate = normPath(pathJoin(sourceDir, sourcePath));
        if (knownFiles.has(candidate)) {
            return [candidate, false];
        }

        if (knownFiles.has(sourcePath)) {
            return [sourcePath, false];
        }

        return [candidate, false];
    }

    function resolveCInclude(included, sourceFile, knownFiles, basenameIndex = null) {
        const sourceDir = pathDirname(sourceFile);
        let candidate;
        if (sourceDir) {
            candidate = normPath(pathJoin(sourceDir, included));
        } else {
            candidate = normPath(included);
        }
        if (knownFiles.has(candidate)) {
            return candidate;
        }

        const normed = normPath(included);
        if (knownFiles.has(normed)) {
            return normed;
        }

        const basename = pathBasename(included);
        if (basenameIndex && basenameIndex[basename]) {
            const matches = basenameIndex[basename];
            if (matches.length > 0) {
                return matches.reduce((a, b) => a.length < b.length ? a : b);
            }
        } else {
            for (const kf of knownFiles) {
                if (pathBasename(kf) === basename) {
                    return kf;
                }
            }
        }

        return null;
    }

    // =========================================================================
    // Tarjan's SCC algorithm
    // =========================================================================

    function findSccs(adj) {
        let indexCounter = 0;
        const stack = [];
        const indices = {};
        const lowlinks = {};
        const onStack = new Set();
        const sccs = [];

        for (const root of Object.keys(adj)) {
            if (root in indices) continue;

            const callStack = [[root, adj[root] ? adj[root][Symbol.iterator]() : [][Symbol.iterator](), false]];

            while (callStack.length > 0) {
                const [v, children, initialised] = callStack[callStack.length - 1];

                if (!initialised) {
                    indices[v] = indexCounter;
                    lowlinks[v] = indexCounter;
                    indexCounter++;
                    stack.push(v);
                    onStack.add(v);
                    callStack[callStack.length - 1][2] = true;
                }

                let recurse = false;
                for (const w of children) {
                    if (!(w in indices)) {
                        callStack.push([w, adj[w] ? adj[w][Symbol.iterator]() : [][Symbol.iterator](), false]);
                        recurse = true;
                        break;
                    } else if (onStack.has(w)) {
                        lowlinks[v] = Math.min(lowlinks[v], indices[w]);
                    }
                }

                if (recurse) continue;

                if (lowlinks[v] === indices[v]) {
                    const scc = [];
                    while (true) {
                        const w = stack.pop();
                        onStack.delete(w);
                        scc.push(w);
                        if (w === v) break;
                    }
                    sccs.push(scc);
                }

                callStack.pop();
                if (callStack.length > 0) {
                    const parent = callStack[callStack.length - 1][0];
                    lowlinks[parent] = Math.min(lowlinks[parent], lowlinks[v]);
                }
            }
        }

        return sccs;
    }

    // =========================================================================
    // Risk classification
    // =========================================================================

    function classifyNodeRisk(nodeData, totalNodes) {
        const inDeg = nodeData.in_degree || 0;
        const outDeg = nodeData.out_degree || 0;
        const inCycle = nodeData.in_cycle || false;
        const reachPct = nodeData.reach_pct || 0;
        const nid = nodeData.id || '';

        if (nid.startsWith('system:') || nid.startsWith('<')) {
            return 'system';
        }

        let criticalIn, highIn, warningOut;
        if (totalNodes <= 10) {
            criticalIn = 5;
            highIn = 3;
            warningOut = 4;
        } else if (totalNodes <= 50) {
            criticalIn = 8;
            highIn = 5;
            warningOut = 6;
        } else {
            criticalIn = Math.max(10, Math.floor(totalNodes / 5));
            highIn = Math.max(5, Math.floor(totalNodes / 10));
            warningOut = Math.max(8, Math.floor(totalNodes / 8));
        }

        if (inCycle || inDeg >= criticalIn || reachPct >= 50) {
            return 'critical';
        }

        if (inDeg >= highIn || reachPct >= 30) {
            return 'high';
        }

        if (outDeg >= warningOut) {
            return 'warning';
        }

        if (inDeg === 0) {
            return 'entry';
        }

        return 'normal';
    }

    function nodeSizeForDegree(inDegree, totalNodes) {
        return 80 + inDegree * 40;
    }

    // =========================================================================
    // Language detection
    // =========================================================================

    function detectLanguages(fileContents) {
        const flags = {};
        for (const [flag] of LANG_EXTENSION_TABLE) {
            const hasKey = 'has_' + flag.substring('show_'.length);
            flags[hasKey] = false;
        }

        for (const [path] of fileContents) {
            for (const [flag, exts] of LANG_EXTENSION_TABLE) {
                const hasKey = 'has_' + flag.substring('show_'.length);
                if (!flags[hasKey]) {
                    for (const ext of exts) {
                        if (path.endsWith(ext)) {
                            flags[hasKey] = true;
                            break;
                        }
                    }
                }
            }
            if (Object.values(flags).every(v => v)) {
                return flags;
            }
        }
        return flags;
    }

    // =========================================================================
    // Filter parsing
    // =========================================================================

    const _DEFAULT_ON_LANGS = new Set(['show_c', 'show_h', 'show_cpp']);

    function parseFilters(source, detected = null) {
        function toBool(val, defaultVal = false) {
            if (typeof val === 'boolean') return val;
            if (typeof val === 'string') return val.toLowerCase() === 'true';
            return defaultVal;
        }

        const mode = source.mode || '';
        let lang;

        if (mode === 'auto' && detected) {
            lang = {};
            for (const [flag] of LANG_EXTENSION_TABLE) {
                const hasKey = 'has_' + flag.substring('show_'.length);
                lang[flag] = detected[hasKey] || false;
            }
        } else if (mode === 'auto') {
            lang = {};
            for (const [flag] of LANG_EXTENSION_TABLE) {
                lang[flag] = true;
            }
        } else {
            lang = {};
            for (const [flag] of LANG_EXTENSION_TABLE) {
                const defaultVal = _DEFAULT_ON_LANGS.has(flag);
                lang[flag] = toBool(source[flag], defaultVal);
            }
        }

        return {
            hide_system: toBool(source.hide_system, false),
            ...lang,
            hide_isolated: toBool(source.hide_isolated, false),
            filter_dir: source.filter_dir || '',
        };
    }

    // =========================================================================
    // Main graph builder
    // =========================================================================

    function buildGraphClientSide(fileContents, options = {}) {
        const {
            langFlags = {},
            hideSystem = false,
            hideIsolated = false,
            filterDir = '',
        } = options;

        // Ensure fileContents is a Map
        if (!(fileContents instanceof Map)) {
            const m = new Map();
            for (const [k, v] of Object.entries(fileContents)) {
                m.set(k, v);
            }
            fileContents = m;
        }

        const nodes = [];
        const edges = [];
        const nodeSet = new Set();
        const knownFiles = new Set(fileContents.keys());

        // Pre-read go.mod if available
        let goModulePath = null;
        if (langFlags.show_go) {
            for (const [path, content] of fileContents) {
                if (path.endsWith('go.mod')) {
                    goModulePath = parseGoMod(content);
                    break;
                }
            }
        }

        // Pre-scan C# and PHP namespaces
        const [csNsMap, csClassMap] = langFlags.show_cs
            ? buildCsNamespaceMap(fileContents)
            : [{}, {}];

        const [phpNsMap, phpClassMap] = langFlags.show_php
            ? buildPhpNamespaceMap(fileContents)
            : [{}, {}];

        // Build basename index for C/C++
        const cBasenameIdx = {};
        for (const kf of knownFiles) {
            const bn = pathBasename(kf);
            if (!cBasenameIdx[bn]) cBasenameIdx[bn] = [];
            cBasenameIdx[bn].push(kf);
        }

        const cache = new ResolutionCache();

        function addEdge(source, target) {
            edges.push({
                data: {
                    source: source,
                    target: target,
                    color: '#94a3b8',
                }
            });
            if (!nodeSet.has(target)) {
                nodes.push({ data: { id: target, color: colorForPath(target) } });
                nodeSet.add(target);
            }
        }

        // Language handlers
        const handlers = [];

        function handlePython(content, filename) {
            content = collapsePyMultilineImports(content);
            for (const m of content.matchAll(PY_FROM_IMPORT_RE)) {
                const fromPath = m[1];
                const names = m[2];
                if (fromPath && !fromPath.replace(/\./g, '')) {
                    for (const name of names.split(',')) {
                        const n = name.trim();
                        if (!n || n === '*') continue;
                        const mod = fromPath + n;
                        let cached = cache.get('py', mod, filename);
                        if (!cached) {
                            cached = resolvePyImport(mod, filename, '', knownFiles);
                            cache.put('py', mod, filename, cached);
                        }
                        const [resolved, isExternal] = cached;
                        if (hideSystem && isExternal) continue;
                        addEdge(filename, resolved);
                    }
                } else {
                    let cached = cache.get('py', fromPath, filename);
                    if (!cached) {
                        cached = resolvePyImport(fromPath, filename, '', knownFiles);
                        cache.put('py', fromPath, filename, cached);
                    }
                    const [resolved, isExternal] = cached;
                    if (hideSystem && isExternal) continue;
                    addEdge(filename, resolved);
                }
            }

            for (const m of content.matchAll(PY_IMPORT_RE)) {
                for (const mod of m[1].split(',')) {
                    const m2 = mod.trim();
                    if (!m2) continue;
                    let cached = cache.get('py', m2, filename);
                    if (!cached) {
                        cached = resolvePyImport(m2, filename, '', knownFiles);
                        cache.put('py', m2, filename, cached);
                    }
                    const [resolved, isExternal] = cached;
                    if (hideSystem && isExternal) continue;
                    addEdge(filename, resolved);
                }
            }
        }

        function handleJava(content, filename) {
            for (const m of content.matchAll(JAVA_IMPORT_RE)) {
                const importPath = m[1];
                let cached = cache.get('java', importPath);
                if (!cached) {
                    cached = resolveJavaImport(importPath, '', knownFiles);
                    cache.put('java', importPath, null, cached);
                }
                for (const [resolved, isExternal] of cached) {
                    if (hideSystem && isExternal) continue;
                    addEdge(filename, resolved);
                }
            }
        }

        function handleGo(content, filename) {
            for (const m of content.matchAll(GO_IMPORT_RE)) {
                const group = m[1];
                if (group !== undefined) {
                    for (const pm of group.matchAll(GO_IMPORT_PATH_RE)) {
                        const imp = pm[1];
                        let cached = cache.get('go', imp);
                        if (!cached) {
                            cached = resolveGoImport(imp, '', knownFiles, goModulePath);
                            cache.put('go', imp, null, cached);
                        }
                        const [resolved, isExternal] = cached;
                        if (hideSystem && isExternal) continue;
                        addEdge(filename, resolved);
                    }
                } else {
                    const imp = m[2];
                    let cached = cache.get('go', imp);
                    if (!cached) {
                        cached = resolveGoImport(imp, '', knownFiles, goModulePath);
                        cache.put('go', imp, null, cached);
                    }
                    const [resolved, isExternal] = cached;
                    if (hideSystem && isExternal) continue;
                    addEdge(filename, resolved);
                }
            }
        }

        function handleRust(content, filename) {
            for (const m of content.matchAll(RUST_MOD_RE)) {
                const modName = m[1];
                let cached = cache.get('rust_mod', modName, filename);
                if (!cached) {
                    cached = resolveRustMod(modName, filename, '', knownFiles);
                    cache.put('rust_mod', modName, filename, cached);
                }
                const [resolved, isExternal] = cached;
                addEdge(filename, resolved);
            }

            for (const m of content.matchAll(RUST_USE_RE)) {
                const usePath = m[1].replace(/:+$/, '');
                const topCrate = usePath.split('::')[0];
                if (['crate', 'self', 'super'].includes(topCrate)) {
                    const parts = usePath.split('::').filter(p => p);
                    const resolvedParts = [];
                    if (parts[0] === 'crate') {
                        resolvedParts.push(...parts.slice(1));
                    } else if (parts[0] === 'self') {
                        const selfDir = pathDirname(filename);
                        if (selfDir) resolvedParts.push(selfDir);
                        resolvedParts.push(...parts.slice(1));
                    } else if (parts[0] === 'super') {
                        let superCount = 0;
                        for (const p of parts) {
                            if (p === 'super') superCount++;
                            else break;
                        }
                        let base = filename;
                        for (let i = 0; i < superCount + 1; i++) {
                            base = pathDirname(base);
                        }
                        if (base) resolvedParts.push(base);
                        resolvedParts.push(...parts.slice(superCount));
                    }

                    const filtered = resolvedParts.filter(p => p);
                    if (filtered.length > 0) {
                        let candidate = filtered.join('/') + '.rs';
                        if (knownFiles.has(candidate)) {
                            addEdge(filename, candidate);
                            continue;
                        }
                        candidate = filtered.join('/') + '/mod.rs';
                        if (knownFiles.has(candidate)) {
                            addEdge(filename, candidate);
                            continue;
                        }
                    }
                } else {
                    if (hideSystem) continue;
                    addEdge(filename, topCrate);
                }
            }

            for (const m of content.matchAll(RUST_EXTERN_RE)) {
                const crateName = m[1];
                if (hideSystem) continue;
                addEdge(filename, crateName);
            }
        }

        function handleCSharp(content, filename) {
            for (const m of content.matchAll(CS_USING_RE)) {
                const namespace = m[1];
                let cached = cache.get('cs', namespace);
                if (!cached) {
                    cached = resolveCsUsing(namespace, '', knownFiles, csNsMap, csClassMap);
                    cache.put('cs', namespace, null, cached);
                }
                const [resolvedList, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                for (const resolved of resolvedList) {
                    if (resolved !== filename) {
                        addEdge(filename, resolved);
                    }
                }
            }
        }

        function handleSwift(content, filename) {
            for (const m of content.matchAll(SWIFT_IMPORT_RE)) {
                const moduleName = m[1];
                let cached = cache.get('swift', moduleName, filename);
                if (!cached) {
                    cached = resolveSwiftImport(moduleName, filename, '', knownFiles);
                    cache.put('swift', moduleName, filename, cached);
                }
                const [resolved, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                addEdge(filename, resolved);
            }
        }

        function handleRuby(content, filename) {
            for (const m of content.matchAll(RUBY_REQUIRE_RELATIVE_RE)) {
                const reqPath = m[1];
                let cached = cache.get('ruby_rel', reqPath, filename);
                if (!cached) {
                    cached = resolveRubyRequire(reqPath, filename, '', knownFiles, true);
                    cache.put('ruby_rel', reqPath, filename, cached);
                }
                const [resolved, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                addEdge(filename, resolved);
            }

            for (const m of content.matchAll(RUBY_REQUIRE_RE)) {
                const reqPath = m[1];
                const lineStart = Math.max(0, content.lastIndexOf('\n', m.index) + 1);
                const lineText = content.substring(lineStart, m.index + m[0].length);
                if (lineText.includes('require_relative')) continue;
                let cached = cache.get('ruby', reqPath);
                if (!cached) {
                    cached = resolveRubyRequire(reqPath, filename, '', knownFiles, false);
                    cache.put('ruby', reqPath, null, cached);
                }
                const [resolved, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                addEdge(filename, resolved);
            }
        }

        function handleKotlin(content, filename) {
            for (const m of content.matchAll(KOTLIN_IMPORT_RE)) {
                const importPath = m[1];
                let cached = cache.get('kotlin', importPath);
                if (!cached) {
                    cached = resolveKotlinImport(importPath, '', knownFiles);
                    cache.put('kotlin', importPath, null, cached);
                }
                const [resolved, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                addEdge(filename, resolved);
            }
        }

        function handleScala(content, filename) {
            for (const m of content.matchAll(SCALA_IMPORT_RE)) {
                const importPath = m[1];
                let cached = cache.get('scala', importPath);
                if (!cached) {
                    cached = resolveScalaImport(importPath, '', knownFiles);
                    cache.put('scala', importPath, null, cached);
                }
                const [resolved, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                addEdge(filename, resolved);
            }
        }

        function handlePhp(content, filename) {
            for (const m of content.matchAll(PHP_USE_RE)) {
                const namespace = m[1];
                let cached = cache.get('php_use', namespace);
                if (!cached) {
                    cached = resolvePhpUse(namespace, '', knownFiles, phpNsMap, phpClassMap);
                    cache.put('php_use', namespace, null, cached);
                }
                const [resolved, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                if (resolved !== filename) {
                    addEdge(filename, resolved);
                }
            }

            for (const m of content.matchAll(PHP_REQUIRE_RE)) {
                const reqPath = m[1];
                let cached = cache.get('php_req', reqPath, filename);
                if (!cached) {
                    cached = resolvePhpRequire(reqPath, filename, '', knownFiles);
                    cache.put('php_req', reqPath, filename, cached);
                }
                const [resolved, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                addEdge(filename, resolved);
            }
        }

        function handleDart(content, filename) {
            for (const m of content.matchAll(DART_IMPORT_RE)) {
                const importPath = m[1];
                let cached = cache.get('dart', importPath, filename);
                if (!cached) {
                    cached = resolveDartImport(importPath, filename, '', knownFiles);
                    cache.put('dart', importPath, filename, cached);
                }
                const [resolved, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                addEdge(filename, resolved);
            }
        }

        function handleElixir(content, filename) {
            for (const m of content.matchAll(ELIXIR_ALIAS_RE)) {
                const moduleName = m[1];
                let cached = cache.get('elixir', moduleName, filename);
                if (!cached) {
                    cached = resolveElixirModule(moduleName, filename, '', knownFiles);
                    cache.put('elixir', moduleName, filename, cached);
                }
                const [resolved, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                addEdge(filename, resolved);
            }
        }

        function handleLua(content, filename) {
            for (const m of content.matchAll(LUA_REQUIRE_RE)) {
                const reqPath = m[1];
                let cached = cache.get('lua', reqPath, filename);
                if (!cached) {
                    cached = resolveLuaRequire(reqPath, filename, '', knownFiles);
                    cache.put('lua', reqPath, filename, cached);
                }
                const [resolved, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                addEdge(filename, resolved);
            }
        }

        function handleZig(content, filename) {
            for (const m of content.matchAll(ZIG_IMPORT_RE)) {
                const importPath = m[1];
                let cached = cache.get('zig', importPath, filename);
                if (!cached) {
                    cached = resolveZigImport(importPath, filename, '', knownFiles);
                    cache.put('zig', importPath, filename, cached);
                }
                const [resolved, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                addEdge(filename, resolved);
            }
        }

        function handleHaskell(content, filename) {
            for (const m of content.matchAll(HASKELL_IMPORT_RE)) {
                const moduleName = m[1];
                let cached = cache.get('haskell', moduleName, filename);
                if (!cached) {
                    cached = resolveHaskellImport(moduleName, filename, '', knownFiles);
                    cache.put('haskell', moduleName, filename, cached);
                }
                const [resolved, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                addEdge(filename, resolved);
            }
        }

        function handleR(content, filename) {
            for (const m of content.matchAll(R_LIBRARY_RE)) {
                const pkgName = m[1];
                if (pkgName) {
                    if (hideSystem) continue;
                    addEdge(filename, pkgName);
                }
            }

            for (const m of content.matchAll(R_SOURCE_RE)) {
                const sourcePath = m[1];
                let cached = cache.get('r_source', sourcePath, filename);
                if (!cached) {
                    cached = resolveRSource(sourcePath, filename, '', knownFiles);
                    cache.put('r_source', sourcePath, filename, cached);
                }
                const [resolved, isExternal] = cached;
                if (hideSystem && isExternal) continue;
                addEdge(filename, resolved);
            }
        }

        function handleCCppJs(content, filename) {
            const isJs = JS_EXTENSIONS.some(ext => filename.endsWith(ext));
            const lines = content.split('\n');

            for (const line of lines) {
                if (!isJs) {
                    const match = INCLUDE_RE.exec(line);
                    if (!match) continue;

                    const isSystem = match[1] === '<';
                    if (hideSystem && isSystem) continue;

                    const included = match[2];
                    if (includeTargetExcluded(included, langFlags)) continue;

                    let cached = cache.get('c_include', included, filename);
                    if (!cached) {
                        const resolved = resolveCInclude(included, filename, knownFiles, cBasenameIdx);
                        if (resolved) {
                            cached = [resolved, false];
                        } else if (isSystem) {
                            if (hideSystem) continue;
                            cached = [included, true];
                        } else {
                            cached = [included, false];
                        }
                        cache.put('c_include', included, filename, cached);
                    }

                    const [target, isExt] = cached;
                    if (hideSystem && isExt) continue;
                    addEdge(filename, target);
                } else {
                    const match = JS_IMPORT_RE.exec(line);
                    if (!match) continue;

                    const rawPath = match[1] || match[2];
                    let cached = cache.get('js', rawPath, filename);
                    if (!cached) {
                        cached = resolveJsImport(rawPath, filename, '', knownFiles);
                        cache.put('js', rawPath, filename, cached);
                    }
                    const [resolved, isExternal] = cached;

                    if (hideSystem && isExternal) continue;

                    addEdge(filename, resolved);
                }
            }
        }

        // Register handlers based on enabled languages
        if (langFlags.show_py) {
            handlers.push([PY_EXTENSIONS, handlePython]);
        }
        if (langFlags.show_java) {
            handlers.push([JAVA_EXTENSIONS, handleJava]);
        }
        if (langFlags.show_go) {
            handlers.push([GO_EXTENSIONS, handleGo]);
        }
        if (langFlags.show_rust) {
            handlers.push([RUST_EXTENSIONS, handleRust]);
        }
        if (langFlags.show_cs) {
            handlers.push([CS_EXTENSIONS, handleCSharp]);
        }
        if (langFlags.show_swift) {
            handlers.push([SWIFT_EXTENSIONS, handleSwift]);
        }
        if (langFlags.show_ruby) {
            handlers.push([RUBY_EXTENSIONS, handleRuby]);
        }
        if (langFlags.show_kotlin) {
            handlers.push([KOTLIN_EXTENSIONS, handleKotlin]);
        }
        if (langFlags.show_scala) {
            handlers.push([SCALA_EXTENSIONS, handleScala]);
        }
        if (langFlags.show_php) {
            handlers.push([PHP_EXTENSIONS, handlePhp]);
        }
        if (langFlags.show_dart) {
            handlers.push([DART_EXTENSIONS, handleDart]);
        }
        if (langFlags.show_elixir) {
            handlers.push([ELIXIR_EXTENSIONS, handleElixir]);
        }
        if (langFlags.show_lua) {
            handlers.push([LUA_EXTENSIONS, handleLua]);
        }
        if (langFlags.show_zig) {
            handlers.push([ZIG_EXTENSIONS, handleZig]);
        }
        if (langFlags.show_haskell) {
            handlers.push([HASKELL_EXTENSIONS, handleHaskell]);
        }
        if (langFlags.show_r) {
            handlers.push([R_EXTENSIONS, handleR]);
        }

        // Add C/C++/JS combined handler
        const cCppJsExts = [];
        if (langFlags.show_c) cCppJsExts.push(...C_EXTENSIONS);
        if (langFlags.show_h) cCppJsExts.push(...H_EXTENSIONS);
        if (langFlags.show_cpp) cCppJsExts.push(...CPP_EXTENSIONS);
        if (langFlags.show_js) cCppJsExts.push(...JS_EXTENSIONS);
        if (cCppJsExts.length > 0) {
            handlers.push([cCppJsExts, handleCCppJs]);
        }

        // Parse all files
        for (const [filepath, content] of fileContents) {
            const filename = filepath;

            if (!nodeSet.has(filename)) {
                nodes.push({ data: { id: filename, color: colorForPath(filename) } });
                nodeSet.add(filename);
            }

            for (const [exts, handler] of handlers) {
                let matches = false;
                for (const ext of exts) {
                    if (filepath.endsWith(ext)) {
                        matches = true;
                        break;
                    }
                }
                if (matches) {
                    handler(content, filename);
                    break;
                }
            }
        }

        // --- Transitive reduction ---
        const adjSet = {};
        for (const edge of edges) {
            const src = edge.data.source;
            const tgt = edge.data.target;
            if (!adjSet[src]) adjSet[src] = new Set();
            adjSet[src].add(tgt);
        }

        const redundant = new Set();
        for (const src in adjSet) {
            const directTargets = adjSet[src];
            for (const mid of directTargets) {
                const stack = Array.from(adjSet[mid] || []);
                const visited = new Set();
                while (stack.length > 0) {
                    const cur = stack.pop();
                    if (visited.has(cur)) continue;
                    visited.add(cur);
                    if (directTargets.has(cur) && cur !== mid) {
                        redundant.add(JSON.stringify([src, cur]));
                    }
                    if (adjSet[cur]) {
                        stack.push(...adjSet[cur]);
                    }
                }
            }
        }

        if (redundant.size > 0) {
            const edgeFilter = edges.filter(e => {
                const key = JSON.stringify([e.data.source, e.data.target]);
                return !redundant.has(key);
            });
            edges.length = 0;
            edges.push(...edgeFilter);
        }

        // --- Cycle detection ---
        const adj = {};
        for (const node of nodes) {
            const nid = node.data.id;
            adj[nid] = [];
        }
        for (const edge of edges) {
            const src = edge.data.source;
            const tgt = edge.data.target;
            if (!adj[src]) adj[src] = [];
            adj[src].push(tgt);
        }

        const sccs = findSccs(adj);

        const cycleNodes = new Set();
        const cyclesList = [];
        for (const scc of sccs) {
            if (scc.length > 1) {
                scc.forEach(n => cycleNodes.add(n));
                cyclesList.push(scc);
            }
        }

        const sccLookup = {};
        for (const scc of sccs) {
            if (scc.length > 1) {
                for (const nodeId of scc) {
                    sccLookup[nodeId] = scc;
                }
            }
        }

        let hasCycleEdges = false;
        for (const edge of edges) {
            const u = edge.data.source;
            const v = edge.data.target;
            if (u === v) {
                edge.classes = 'cycle';
                hasCycleEdges = true;
                if (!cyclesList.find(c => c.length === 1 && c[0] === u)) {
                    cyclesList.push([u]);
                }
            } else if (sccLookup[u] && sccLookup[v] && sccLookup[u] === sccLookup[v]) {
                edge.classes = 'cycle';
                hasCycleEdges = true;
            }
        }

        // --- Compute in-degrees ---
        const inDegrees = {};
        for (const node of nodes) {
            inDegrees[node.data.id] = 0;
        }
        for (const edge of edges) {
            const tgt = edge.data.target;
            if (tgt in inDegrees) {
                inDegrees[tgt]++;
            }
        }

        const totalNodesForSize = nodes.length;
        for (const node of nodes) {
            const nid = node.data.id;
            node.data.size = nodeSizeForDegree(inDegrees[nid], totalNodesForSize);
        }

        // --- Compute out-degrees ---
        const outDegrees = {};
        for (const node of nodes) {
            outDegrees[node.data.id] = 0;
        }
        for (const edge of edges) {
            const src = edge.data.source;
            if (src in outDegrees) {
                outDegrees[src]++;
            }
        }

        // --- Dependency depth ---
        const depDepth = {};
        for (const start in adj) {
            if (start in depDepth) continue;
            const dfsStack = [[start, 0, 0]];
            const visiting = new Set([start]);

            while (dfsStack.length > 0) {
                const [nodeId, childIdx, maxSoFar] = dfsStack[dfsStack.length - 1];
                const children = adj[nodeId] || [];
                let advanced = false;

                let ci = childIdx;
                while (ci < children.length) {
                    const w = children[ci];
                    ci++;
                    if (visiting.has(w)) continue;
                    if (w in depDepth) {
                        dfsStack[dfsStack.length - 1][2] = Math.max(maxSoFar, 1 + depDepth[w]);
                    } else {
                        dfsStack[dfsStack.length - 1][1] = ci;
                        dfsStack[dfsStack.length - 1][2] = maxSoFar;
                        dfsStack.push([w, 0, 0]);
                        visiting.add(w);
                        advanced = true;
                        break;
                    }
                }

                if (!advanced) {
                    depDepth[nodeId] = dfsStack[dfsStack.length - 1][2];
                    visiting.delete(nodeId);
                    dfsStack.pop();
                    if (dfsStack.length > 0) {
                        const [pn, pi, pm] = dfsStack[dfsStack.length - 1];
                        dfsStack[dfsStack.length - 1][2] = Math.max(pm, 1 + depDepth[nodeId]);
                    }
                }
            }
        }

        for (const node of nodes) {
            const nid = node.data.id;
            node.data.depth = depDepth[nid] || 0;
        }

        // --- Impact analysis ---
        const revAdj = {};
        for (const node of nodes) {
            revAdj[node.data.id] = [];
        }
        for (const edge of edges) {
            const src = edge.data.source;
            const tgt = edge.data.target;
            if (!revAdj[tgt]) revAdj[tgt] = [];
            revAdj[tgt].push(src);
        }

        const impact = {};

        function downstreamClosure(nodeId) {
            if (nodeId in impact) return impact[nodeId];
            const visited = new Set();
            const stack = [nodeId];
            while (stack.length > 0) {
                const cur = stack.pop();
                for (const dep of revAdj[cur] || []) {
                    if (!visited.has(dep) && dep !== nodeId) {
                        visited.add(dep);
                        stack.push(dep);
                    }
                }
            }
            impact[nodeId] = visited.size;
            return impact[nodeId];
        }

        for (const nid in revAdj) {
            downstreamClosure(nid);
        }

        for (const node of nodes) {
            const nid = node.data.id;
            node.data.impact = impact[nid] || 0;
        }

        // --- Per-node enrichment ---
        const totalNodes = nodes.length;
        for (const node of nodes) {
            const nid = node.data.id;
            const nd = node.data;
            const ca = inDegrees[nid] || 0;
            const ce = outDegrees[nid] || 0;
            nd.stability = (ca + ce) > 0 ? Math.round(ce / (ca + ce) * 1000) / 1000 : 0.5;
            nd.in_degree = ca;
            nd.out_degree = ce;
            nd.language = langForPath(nid);
            nd.in_cycle = cycleNodes.has(nid);
        }

        // --- Unused files ---
        const unusedFiles = [];
        for (const nid in inDegrees) {
            if (inDegrees[nid] === 0) {
                unusedFiles.push(nid);
            }
        }

        // --- Coupling scores ---
        const dirEdges = {};
        const dirTotal = {};
        for (const edge of edges) {
            const srcDir = pathDirname(edge.data.source) || '.';
            const tgtDir = pathDirname(edge.data.target) || '.';
            if (srcDir !== tgtDir) {
                const pair = [srcDir, tgtDir].sort().join('\0');
                dirEdges[pair] = (dirEdges[pair] || 0) + 1;
            }
            dirTotal[srcDir] = (dirTotal[srcDir] || 0) + 1;
            dirTotal[tgtDir] = (dirTotal[tgtDir] || 0) + 1;
        }

        const couplingScores = [];
        const sortedPairs = Object.entries(dirEdges)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);

        for (const [pair, crossCount] of sortedPairs) {
            const [d1, d2] = pair.split('\0');
            const total = (dirTotal[d1] || 0) + (dirTotal[d2] || 0);
            const score = total > 0 ? Math.round(crossCount / total * 1000) / 1000 : 0;
            couplingScores.push({
                dir1: d1,
                dir2: d2,
                cross_edges: crossCount,
                score: score,
            });
        }

        // --- Optional filters ---
        if (hideIsolated) {
            const connected = new Set();
            for (const edge of edges) {
                connected.add(edge.data.source);
                connected.add(edge.data.target);
            }
            nodes.length = 0;
            for (const node of [...nodes]) {
                if (connected.has(node.data.id)) {
                    nodes.push(node);
                }
            }
        }

        if (filterDir) {
            const filtered = [];
            for (const node of nodes) {
                if (node.data.id.startsWith(filterDir)) {
                    filtered.push(node);
                }
            }
            nodes.length = 0;
            nodes.push(...filtered);
            const validIds = new Set(nodes.map(n => n.data.id));
            const filteredEdges = [];
            for (const edge of edges) {
                if (validIds.has(edge.data.source) && validIds.has(edge.data.target)) {
                    filteredEdges.push(edge);
                }
            }
            edges.length = 0;
            edges.push(...filteredEdges);
        }

        // --- Depth warnings ---
        const totalFiles = nodes.length || 1;
        const depthWarnings = [];
        for (const node of nodes) {
            const nd = node.data;
            const fileId = nd.id;
            const fileDepth = nd.depth || 0;
            const fileImpact = nd.impact || 0;
            const reachPct = Math.round(fileImpact / totalFiles * 1000) / 10;
            nd.reach_pct = reachPct;

            let severity = null;
            const reasons = [];

            if (reachPct >= 50) {
                severity = 'critical';
                reasons.push(`pulls in ${reachPct}% of codebase`);
            } else if (reachPct >= 30) {
                severity = 'warning';
                reasons.push(`pulls in ${reachPct}% of codebase`);
            }

            if (fileDepth >= 8) {
                severity = 'critical';
                reasons.push(`dependency chain ${fileDepth} levels deep`);
            } else if (fileDepth >= 5) {
                if (severity !== 'critical') severity = 'warning';
                reasons.push(`dependency chain ${fileDepth} levels deep`);
            }

            if (severity) {
                depthWarnings.push({
                    file: fileId,
                    severity: severity,
                    depth: fileDepth,
                    impact: fileImpact,
                    reach_pct: reachPct,
                    reasons: reasons,
                });
            }
        }

        depthWarnings.sort((a, b) => {
            const aSev = a.severity === 'critical' ? 0 : 1;
            const bSev = b.severity === 'critical' ? 0 : 1;
            if (aSev !== bSev) return aSev - bSev;
            return b.reach_pct - a.reach_pct;
        });

        // --- Risk classification ---
        const nodeDataLookup = {};
        for (const node of nodes) {
            const nd = node.data;
            const risk = classifyNodeRisk(nd, totalFiles);
            nd.risk = risk;
            nd.risk_color = RISK_COLORS[risk];
            nd.risk_label = RISK_LABELS[risk];
            nd.dir_color = dirColor(nd.id);
            nodeDataLookup[nd.id] = nd;
        }

        // --- Edge weighting ---
        const maxIn = Object.values(inDegrees).length > 0 ? Math.max(...Object.values(inDegrees)) : 1;
        for (const edge of edges) {
            const tgt = edge.data.target;
            const tgtData = nodeDataLookup[tgt] || {};
            const tgtIn = inDegrees[tgt] || 0;
            const tgtReach = tgtData.reach_pct || 0;
            const raw = (tgtIn / Math.max(maxIn, 1)) * 0.6 + (tgtReach / 100) * 0.4;
            edge.data.weight = Math.round((1 + 4 * Math.min(raw, 1.0)) * 100) / 100;
        }

        return {
            nodes: nodes,
            edges: edges,
            has_cycles: hasCycleEdges,
            cycles: cyclesList,
            unused_files: unusedFiles,
            coupling: couplingScores,
            depth_warnings: depthWarnings,
        };
    }

    // =========================================================================
    // Public API
    // =========================================================================

    return {
        buildGraph: buildGraphClientSide,
        detectLanguages: detectLanguages,
        parseFilters: parseFilters,
        LANG_EXTENSION_TABLE: LANG_EXTENSION_TABLE,
        ResolutionCache: ResolutionCache,
        RISK_COLORS: RISK_COLORS,
        RISK_LABELS: RISK_LABELS,
        LANGUAGE_COLORS: LANGUAGE_COLORS,
    };
})();
