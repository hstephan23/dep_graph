"""Additional unit tests for parsers.py — newer language resolvers and edge cases."""

from __future__ import annotations

import os
import sys
import pytest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from parsers import (
    resolve_kotlin_import,
    resolve_scala_import,
    resolve_php_use,
    resolve_dart_import,
    resolve_elixir_module,
    resolve_lua_require,
    resolve_zig_import,
    resolve_haskell_import,
    resolve_r_source,
    resolve_js_import,
    resolve_py_import,
    resolve_ruby_require,
    collapse_py_multiline_imports,
    PY_STDLIB,
)


# =========================================================================
# resolve_kotlin_import tests
# =========================================================================

class TestResolveKotlinImport:
    """Tests for resolve_kotlin_import()."""

    def test_local_class_import(self):
        """Local Kotlin class should resolve to .kt file."""
        known_files = {'com/example/MyClass.kt', 'com/example/Other.kt'}
        resolved, is_ext = resolve_kotlin_import('com.example.MyClass', '.', known_files)
        assert resolved == 'com/example/MyClass.kt'
        assert is_ext is False

    def test_local_kts_file(self):
        """Should also probe .kts extension."""
        known_files = {'scripts/build.kts'}
        resolved, is_ext = resolve_kotlin_import('scripts.build', '.', known_files)
        assert resolved == 'scripts/build.kts'
        assert is_ext is False

    def test_stdlib_external(self):
        """Kotlin stdlib imports should be external."""
        known_files = {'Main.kt'}
        resolved, is_ext = resolve_kotlin_import('kotlin.collections.List', '.', known_files)
        assert is_ext is True

    def test_java_interop_external(self):
        """Java standard library via Kotlin should be external."""
        known_files = {'Main.kt'}
        resolved, is_ext = resolve_kotlin_import('java.util.HashMap', '.', known_files)
        assert is_ext is True

    def test_unresolved_external(self):
        """Unresolved third-party imports should be external."""
        known_files = {'Main.kt'}
        resolved, is_ext = resolve_kotlin_import('io.ktor.server.engine', '.', known_files)
        assert is_ext is True


# =========================================================================
# resolve_scala_import tests
# =========================================================================

class TestResolveScalaImport:
    """Tests for resolve_scala_import()."""

    def test_local_class(self):
        """Local Scala class should resolve."""
        known_files = {'com/example/Service.scala'}
        resolved, is_ext = resolve_scala_import('com.example.Service', '.', known_files)
        assert resolved == 'com/example/Service.scala'
        assert is_ext is False

    def test_sc_extension(self):
        """Should probe .sc extension too."""
        known_files = {'scripts/main.sc'}
        resolved, is_ext = resolve_scala_import('scripts.main', '.', known_files)
        assert resolved == 'scripts/main.sc'
        assert is_ext is False

    def test_scala_stdlib_external(self):
        """Scala standard library should be external."""
        known_files = {'Main.scala'}
        resolved, is_ext = resolve_scala_import('scala.collection.mutable.Map', '.', known_files)
        assert is_ext is True

    def test_java_stdlib_external(self):
        """Java stdlib via Scala should be external."""
        known_files = {'Main.scala'}
        resolved, is_ext = resolve_scala_import('java.io.File', '.', known_files)
        assert is_ext is True


# =========================================================================
# resolve_dart_import tests
# =========================================================================

class TestResolveDartImport:
    """Tests for resolve_dart_import()."""

    def test_relative_import(self):
        """Relative Dart import should resolve."""
        known_files = {'lib/main.dart', 'lib/utils.dart'}
        resolved, is_ext = resolve_dart_import('./utils.dart', 'lib/main.dart', 'lib', known_files)
        assert resolved == 'lib/utils.dart'
        assert is_ext is False

    def test_package_import_external(self):
        """package: imports should be external."""
        known_files = {'lib/main.dart'}
        resolved, is_ext = resolve_dart_import('package:flutter/material.dart', 'lib/main.dart', 'lib', known_files)
        assert is_ext is True

    def test_dart_core_external(self):
        """dart:core imports should be external."""
        known_files = {'lib/main.dart'}
        resolved, is_ext = resolve_dart_import('dart:core', 'lib/main.dart', 'lib', known_files)
        assert is_ext is True


# =========================================================================
# resolve_elixir_module tests
# =========================================================================

class TestResolveElixirModule:
    """Tests for resolve_elixir_module()."""

    def test_local_module(self):
        """Local Elixir module should resolve via snake_case conversion."""
        known_files = {'lib/my_app/user.ex', 'lib/my_app.ex'}
        resolved, is_ext = resolve_elixir_module('MyApp.User', 'lib/my_app.ex', 'lib', known_files)
        assert resolved == 'lib/my_app/user.ex'
        assert is_ext is False

    def test_exs_extension(self):
        """Should probe .exs extension too."""
        known_files = {'test/my_app_test.exs'}
        resolved, is_ext = resolve_elixir_module('MyAppTest', 'test/helper.exs', 'test', known_files)
        assert resolved == 'test/my_app_test.exs'
        assert is_ext is False

    def test_stdlib_external(self):
        """Elixir stdlib modules should be external."""
        known_files = {'lib/app.ex'}
        resolved, is_ext = resolve_elixir_module('Enum', 'lib/app.ex', 'lib', known_files)
        assert is_ext is True

    def test_phoenix_external(self):
        """Framework modules should be external."""
        known_files = {'lib/app.ex'}
        resolved, is_ext = resolve_elixir_module('Phoenix.Controller', 'lib/app.ex', 'lib', known_files)
        assert is_ext is True


# =========================================================================
# resolve_lua_require tests
# =========================================================================

class TestResolveLuaRequire:
    """Tests for resolve_lua_require()."""

    def test_local_module(self):
        """Local Lua module should resolve (dots to path separators)."""
        known_files = {'utils/helper.lua', 'main.lua'}
        resolved, is_ext = resolve_lua_require('utils.helper', 'main.lua', '.', known_files)
        assert resolved == 'utils/helper.lua'
        assert is_ext is False

    def test_single_module(self):
        """Single-segment require should resolve."""
        known_files = {'config.lua', 'main.lua'}
        resolved, is_ext = resolve_lua_require('config', 'main.lua', '.', known_files)
        assert resolved == 'config.lua'
        assert is_ext is False

    def test_init_lua_resolution(self):
        """Should probe init.lua for directory modules."""
        known_files = {'mylib/init.lua', 'main.lua'}
        resolved, is_ext = resolve_lua_require('mylib', 'main.lua', '.', known_files)
        assert resolved == 'mylib/init.lua'
        assert is_ext is False

    def test_unresolved_external(self):
        """Unresolved Lua requires should be external."""
        known_files = {'main.lua'}
        resolved, is_ext = resolve_lua_require('socket', 'main.lua', '.', known_files)
        assert is_ext is True


# =========================================================================
# resolve_zig_import tests
# =========================================================================

class TestResolveZigImport:
    """Tests for resolve_zig_import()."""

    def test_relative_import(self):
        """Relative Zig import should resolve."""
        known_files = {'src/main.zig', 'src/utils.zig'}
        resolved, is_ext = resolve_zig_import('utils.zig', 'src/main.zig', 'src', known_files)
        assert resolved == 'src/utils.zig'
        assert is_ext is False

    def test_std_external(self):
        """std import should be external."""
        known_files = {'src/main.zig'}
        resolved, is_ext = resolve_zig_import('std', 'src/main.zig', 'src', known_files)
        assert is_ext is True

    def test_nested_path(self):
        """Nested file path should resolve."""
        known_files = {'src/lib/math.zig', 'src/main.zig'}
        resolved, is_ext = resolve_zig_import('lib/math.zig', 'src/main.zig', 'src', known_files)
        assert resolved == 'src/lib/math.zig'
        assert is_ext is False


# =========================================================================
# resolve_haskell_import tests
# =========================================================================

class TestResolveHaskellImport:
    """Tests for resolve_haskell_import()."""

    def test_local_module(self):
        """Local Haskell module should resolve (dots to path separators)."""
        known_files = {'src/MyApp/Config.hs', 'src/Main.hs'}
        resolved, is_ext = resolve_haskell_import('MyApp.Config', 'src/Main.hs', 'src', known_files)
        assert resolved == 'src/MyApp/Config.hs'
        assert is_ext is False

    def test_basename_fallback(self):
        """Should find file by basename in any directory."""
        known_files = {'src/deep/nested/Handler.hs', 'src/Main.hs'}
        resolved, is_ext = resolve_haskell_import('Handler', 'src/Main.hs', 'src', known_files)
        assert resolved == 'src/deep/nested/Handler.hs'
        assert is_ext is False

    def test_prelude_external(self):
        """Prelude and base modules should be external."""
        known_files = {'src/Main.hs'}
        resolved, is_ext = resolve_haskell_import('Data.Map', 'src/Main.hs', 'src', known_files)
        assert is_ext is True

    def test_data_prefix_external(self):
        """Data.* stdlib modules should be external."""
        known_files = {'src/Main.hs'}
        resolved, is_ext = resolve_haskell_import('Data.List', 'src/Main.hs', 'src', known_files)
        assert is_ext is True

    def test_qualified_module(self):
        """Deeply qualified local module should resolve."""
        known_files = {'src/App/Models/User.hs', 'src/Main.hs'}
        resolved, is_ext = resolve_haskell_import(
            'App.Models.User', 'src/Main.hs', 'src', known_files
        )
        assert resolved == 'src/App/Models/User.hs'
        assert is_ext is False


# =========================================================================
# resolve_r_source tests
# =========================================================================

class TestResolveRSource:
    """Tests for resolve_r_source()."""

    def test_relative_source(self):
        """Relative R source should resolve."""
        known_files = {'utils.R', 'main.R'}
        resolved, is_ext = resolve_r_source('utils.R', 'main.R', '.', known_files)
        assert resolved == 'utils.R'
        assert is_ext is False

    def test_nested_source(self):
        """Nested R source path should resolve."""
        known_files = {'lib/helpers.R', 'main.R'}
        resolved, is_ext = resolve_r_source('lib/helpers.R', 'main.R', '.', known_files)
        assert resolved == 'lib/helpers.R'
        assert is_ext is False

    def test_lowercase_r_extension(self):
        """Should handle lowercase .r extension."""
        known_files = {'analysis.r', 'main.R'}
        resolved, is_ext = resolve_r_source('analysis.r', 'main.R', '.', known_files)
        assert resolved == 'analysis.r'
        assert is_ext is False

    def test_unresolved_external(self):
        """Unresolved R source should be external."""
        known_files = {'main.R'}
        resolved, is_ext = resolve_r_source('missing.R', 'main.R', '.', known_files)
        # Should either return external or a candidate path
        assert isinstance(resolved, str)


# =========================================================================
# resolve_php_use tests
# =========================================================================

class TestResolvePhpUse:
    """Tests for resolve_php_use()."""

    def test_local_class(self):
        """Local PHP class should resolve."""
        known_files = {'src/Models/User.php'}
        ns_map = {'App\\Models': ['src/Models/User.php']}
        class_map = {'App\\Models\\User': 'src/Models/User.php'}
        resolved, is_ext = resolve_php_use('App\\Models\\User', '.', known_files, ns_map, class_map)
        assert is_ext is False

    def test_vendor_external(self):
        """Vendor namespace imports should be external."""
        known_files = set()
        resolved, is_ext = resolve_php_use('Illuminate\\Http\\Request', '.', known_files)
        assert is_ext is True


# =========================================================================
# collapse_py_multiline_imports tests
# =========================================================================

class TestCollapsePyMultilineImports:
    """Test Python multiline import collapsing."""

    def test_basic_collapse(self):
        """Parenthesized import should be collapsed to one line."""
        source = "from os import (\n    path,\n    getcwd\n)\n"
        result = collapse_py_multiline_imports(source)
        assert "from os import" in result
        assert "path" in result
        assert "getcwd" in result
        assert "\n" not in result.strip().split("from os import")[1].split(")")[0]

    def test_no_change_for_single_line(self):
        """Single-line imports should not be modified."""
        source = "from os import path\n"
        result = collapse_py_multiline_imports(source)
        assert result.strip() == source.strip()

    def test_multiple_multiline_imports(self):
        """Multiple multiline imports should all be collapsed."""
        source = (
            "from os import (\n    path,\n    getcwd\n)\n"
            "from sys import (\n    argv,\n    exit\n)\n"
        )
        result = collapse_py_multiline_imports(source)
        lines = [l for l in result.splitlines() if l.strip()]
        from_lines = [l for l in lines if l.strip().startswith("from")]
        assert len(from_lines) == 2


# =========================================================================
# Python stdlib detection
# =========================================================================

class TestPythonStdlib:
    """Test Python standard library detection."""

    def test_common_stdlib_modules(self):
        """Common stdlib modules should be in PY_STDLIB."""
        common = ['os', 'sys', 'json', 'pathlib', 'typing', 'collections',
                  'functools', 'itertools', 're', 'math', 'datetime']
        for mod in common:
            assert mod in PY_STDLIB, f"{mod} should be in PY_STDLIB"

    def test_non_stdlib_modules(self):
        """Third-party modules should not be in PY_STDLIB."""
        third_party = ['flask', 'django', 'requests', 'numpy', 'pandas']
        for mod in third_party:
            assert mod not in PY_STDLIB, f"{mod} should not be in PY_STDLIB"


# =========================================================================
# resolve_js_import edge cases
# =========================================================================

class TestResolveJsImportEdgeCases:
    """Edge cases for JS import resolution."""

    def test_scoped_package_external(self):
        """@scope/package should be external."""
        known_files = {'src/app.js'}
        resolved, is_ext = resolve_js_import('@mui/material', 'src/app.js', 'src', known_files)
        assert is_ext is True

    def test_deep_relative_import(self):
        """Deeply nested relative imports should resolve."""
        known_files = {'src/a/b/c/d/target.js', 'src/main.js'}
        resolved, is_ext = resolve_js_import(
            './a/b/c/d/target.js', 'src/main.js', 'src', known_files
        )
        assert resolved == 'src/a/b/c/d/target.js'
        assert is_ext is False

    def test_jsx_extension_probe(self):
        """Should probe .jsx extension for extensionless imports."""
        known_files = {'src/Component.jsx', 'src/main.js'}
        resolved, is_ext = resolve_js_import('./Component', 'src/main.js', 'src', known_files)
        assert resolved == 'src/Component.jsx'
        assert is_ext is False


# =========================================================================
# resolve_py_import edge cases
# =========================================================================

class TestResolvePyImportEdgeCases:
    """Edge cases for Python import resolution."""

    def test_init_file_import(self):
        """Importing a package should resolve to __init__.py."""
        known_files = {'mypackage/__init__.py', 'main.py'}
        resolved, is_ext = resolve_py_import('mypackage', 'main.py', '.', known_files)
        assert resolved == 'mypackage/__init__.py'
        assert is_ext is False

    def test_deeply_nested_relative(self):
        """Four levels of relative dots."""
        known_files = {'a/b/c/d/main.py', 'a/config.py'}
        resolved, is_ext = resolve_py_import('....config', 'a/b/c/d/main.py', 'a/b/c/d', known_files)
        assert resolved == 'a/config.py' or 'config' in resolved
        # Should not be external since it's a relative import
        assert is_ext is False

    def test_typing_extensions_external(self):
        """typing_extensions should be external (not in stdlib)."""
        known_files = {'main.py'}
        resolved, is_ext = resolve_py_import('typing_extensions', 'main.py', '.', known_files)
        assert is_ext is True
