"""Unit tests for all resolver functions in parsers.py.

Tests all resolution functions in isolation with synthetic known_files sets.
For functions that need real files on disk (build_cs_namespace_map, parse_go_mod),
uses pytest tmp_path fixture.
"""

import os
import pytest
from parsers import (
    resolve_js_import,
    resolve_py_import,
    resolve_java_import,
    resolve_go_import,
    resolve_rust_mod,
    build_cs_namespace_map,
    resolve_cs_using,
    resolve_swift_import,
    resolve_ruby_require,
    parse_go_mod,
)


# =============================================================================
# resolve_js_import tests
# =============================================================================

class TestResolveJsImport:
    """Tests for resolve_js_import()."""

    def test_bare_import_external(self):
        """Bare imports (react, lodash) should be marked external."""
        known_files = {'src/index.js', 'src/app.js'}

        resolved, is_external = resolve_js_import('react', 'src/index.js', 'src', known_files)
        assert resolved == 'react'
        assert is_external is True

        resolved, is_external = resolve_js_import('lodash', 'src/index.js', 'src', known_files)
        assert resolved == 'lodash'
        assert is_external is True

    def test_relative_import_with_extension(self):
        """Relative imports with known extensions should resolve."""
        known_files = {'src/app.js', 'src/utils.js', 'src/index.js'}

        resolved, is_external = resolve_js_import('./utils.js', 'src/index.js', 'src', known_files)
        assert resolved == 'src/utils.js'
        assert is_external is False

    def test_relative_import_parent_directory(self):
        """Relative imports with .. should resolve to parent directory."""
        known_files = {'src/utils.js', 'lib/helper.js', 'src/index.js'}

        resolved, is_external = resolve_js_import('../lib/helper.js', 'src/index.js', 'src', known_files)
        assert resolved == 'lib/helper.js'
        assert is_external is False

    def test_extensionless_js_resolution(self):
        """Extensionless imports should probe .js, .ts, .tsx, etc."""
        known_files = {'src/app.js', 'src/index.js', 'src/config.ts', 'src/utils.tsx'}

        # Probe for .js
        resolved, is_external = resolve_js_import('./app', 'src/index.js', 'src', known_files)
        assert resolved == 'src/app.js'
        assert is_external is False

        # Probe for .ts
        resolved, is_external = resolve_js_import('./config', 'src/index.js', 'src', known_files)
        assert resolved == 'src/config.ts'
        assert is_external is False

        # Probe for .tsx
        resolved, is_external = resolve_js_import('./utils', 'src/index.js', 'src', known_files)
        assert resolved == 'src/utils.tsx'
        assert is_external is False

    def test_index_file_resolution(self):
        """Import ./foo should resolve to ./foo/index.js."""
        known_files = {'src/components/Button/index.js', 'src/index.js'}

        resolved, is_external = resolve_js_import('./components/Button', 'src/index.js', 'src', known_files)
        assert resolved == 'src/components/Button/index.js'
        assert is_external is False

    def test_index_file_resolution_with_extension_variants(self):
        """Index files with .ts, .tsx should also be detected."""
        known_files = {'src/comp/index.tsx', 'src/index.js'}

        resolved, is_external = resolve_js_import('./comp', 'src/index.js', 'src', known_files)
        assert resolved == 'src/comp/index.tsx'
        assert is_external is False

    def test_unresolved_relative_returns_candidate(self):
        """Unresolved relative imports should return candidate path."""
        known_files = {'src/index.js'}

        resolved, is_external = resolve_js_import('./missing', 'src/index.js', 'src', known_files)
        assert resolved == 'src/missing'
        assert is_external is False

    def test_deeply_nested_relative_imports(self):
        """Should handle deeply nested relative paths."""
        known_files = {'src/a/c/module.js', 'src/a/x/y.js'}

        # ../c/module.js from src/a/x/y.js → parent is src/a/, then c/module.js → src/a/c/module.js
        resolved, is_external = resolve_js_import('../c/module.js', 'src/a/x/y.js', 'src', known_files)
        assert resolved == 'src/a/c/module.js'
        assert is_external is False


# =============================================================================
# resolve_py_import tests
# =============================================================================

class TestResolvePyImport:
    """Tests for resolve_py_import()."""

    def test_stdlib_module_external(self):
        """Standard library modules should be marked external."""
        known_files = {'myapp/main.py'}

        resolved, is_external = resolve_py_import('os', 'myapp/main.py', 'myapp', known_files)
        assert resolved == 'os'
        assert is_external is True

        resolved, is_external = resolve_py_import('json', 'myapp/main.py', 'myapp', known_files)
        assert resolved == 'json'
        assert is_external is True

        resolved, is_external = resolve_py_import('sys', 'myapp/main.py', 'myapp', known_files)
        assert resolved == 'sys'
        assert is_external is True

    def test_absolute_import_single_level(self):
        """Absolute import foo → foo/__init__.py or foo.py."""
        known_files = {'foo/__init__.py', 'main.py'}

        resolved, is_external = resolve_py_import('foo', 'main.py', '.', known_files)
        assert resolved == 'foo/__init__.py'
        assert is_external is False

    def test_absolute_import_module_file(self):
        """Absolute import to module file (not package)."""
        known_files = {'foo.py', 'main.py'}

        resolved, is_external = resolve_py_import('foo', 'main.py', '.', known_files)
        assert resolved == 'foo.py'
        assert is_external is False

    def test_absolute_import_nested(self):
        """Absolute import foo.bar.baz."""
        known_files = {'foo/bar/baz.py', 'main.py'}

        resolved, is_external = resolve_py_import('foo.bar.baz', 'main.py', '.', known_files)
        assert resolved == 'foo/bar/baz.py'
        assert is_external is False

    def test_absolute_import_nested_package(self):
        """Absolute import foo.bar where bar is a package."""
        known_files = {'foo/bar/__init__.py', 'main.py'}

        resolved, is_external = resolve_py_import('foo.bar', 'main.py', '.', known_files)
        assert resolved == 'foo/bar/__init__.py'
        assert is_external is False

    def test_relative_single_dot(self):
        """Relative import . (same directory)."""
        known_files = {'myapp/__init__.py', 'myapp/main.py', 'myapp/helper.py'}

        # from . import helper
        resolved, is_external = resolve_py_import('.helper', 'myapp/main.py', 'myapp', known_files)
        assert resolved == 'myapp/helper.py'
        assert is_external is False

    def test_relative_double_dot(self):
        """Relative import .. (parent directory)."""
        known_files = {'utils.py', 'myapp/main.py', 'myapp/__init__.py'}

        # from .. import utils
        resolved, is_external = resolve_py_import('..utils', 'myapp/main.py', 'myapp', known_files)
        assert resolved == 'utils.py'
        assert is_external is False

    def test_relative_triple_dot(self):
        """Relative import ... (grandparent directory)."""
        known_files = {'config.py', 'pkg/__init__.py', 'pkg/sub/__init__.py', 'pkg/sub/main.py'}

        # from ... import config
        resolved, is_external = resolve_py_import('...config', 'pkg/sub/main.py', 'pkg/sub', known_files)
        assert resolved == 'config.py'
        assert is_external is False

    def test_relative_with_nested_import(self):
        """Relative import with multiple path components."""
        known_files = {'myapp/core/utils.py', 'myapp/main.py', 'myapp/__init__.py'}

        # from .core import utils
        resolved, is_external = resolve_py_import('.core.utils', 'myapp/main.py', 'myapp', known_files)
        assert resolved == 'myapp/core/utils.py'
        assert is_external is False

    def test_non_matching_absolute_import_external(self):
        """Non-stdlib absolute import not found locally should be external."""
        known_files = {'myapp/main.py'}

        resolved, is_external = resolve_py_import('third_party_lib', 'myapp/main.py', 'myapp', known_files)
        assert resolved == 'third_party_lib'
        assert is_external is True

    def test_relative_import_not_found(self):
        """Relative import not found in known_files returns candidate path (still False)."""
        known_files = {'myapp/main.py'}

        resolved, is_external = resolve_py_import('.missing', 'myapp/main.py', 'myapp', known_files)
        assert resolved == 'myapp/missing.py'
        assert is_external is False


# =============================================================================
# resolve_java_import tests
# =============================================================================

class TestResolveJavaImport:
    """Tests for resolve_java_import()."""

    def test_exact_class_import(self):
        """Exact class import com.example.Foo → com/example/Foo.java."""
        known_files = {'com/example/Foo.java', 'com/example/Bar.java'}

        result = resolve_java_import('com.example.Foo', '.', known_files)
        assert result == [('com/example/Foo.java', False)]

    def test_unresolved_exact_class_import(self):
        """Unresolved exact class import should be marked external."""
        known_files = {'com/example/Bar.java'}

        result = resolve_java_import('com.example.Missing', '.', known_files)
        assert result == [('com.example.Missing', True)]

    def test_wildcard_import_multiple_matches(self):
        """Wildcard import com.example.* expands to all files in that package."""
        known_files = {
            'com/example/Foo.java',
            'com/example/Bar.java',
            'com/example/Baz.java',
            'com/other/Thing.java'
        }

        result = resolve_java_import('com.example.*', '.', known_files)
        expected = [
            ('com/example/Foo.java', False),
            ('com/example/Bar.java', False),
            ('com/example/Baz.java', False),
        ]
        assert sorted(result) == sorted(expected)

    def test_wildcard_import_single_match(self):
        """Wildcard with only one file in package."""
        known_files = {'com/example/Only.java'}

        result = resolve_java_import('com.example.*', '.', known_files)
        assert result == [('com/example/Only.java', False)]

    def test_wildcard_import_no_matches(self):
        """Wildcard with no matching files should be external."""
        known_files = {'com/other/Thing.java'}

        result = resolve_java_import('com.example.*', '.', known_files)
        assert result == [('com.example.*', True)]

    def test_wildcard_ignores_nested_subpackages(self):
        """Wildcard should not match files in subpackages."""
        known_files = {
            'com/example/Foo.java',
            'com/example/sub/Bar.java',
            'com/example/sub/nested/Baz.java'
        }

        result = resolve_java_import('com.example.*', '.', known_files)
        assert result == [('com/example/Foo.java', False)]

    def test_deeply_nested_class_import(self):
        """Deeply nested class path."""
        known_files = {'org/apache/commons/lang/StringUtils.java'}

        result = resolve_java_import('org.apache.commons.lang.StringUtils', '.', known_files)
        assert result == [('org/apache/commons/lang/StringUtils.java', False)]


# =============================================================================
# resolve_go_import tests
# =============================================================================

class TestResolveGoImport:
    """Tests for resolve_go_import()."""

    def test_local_package_import(self):
        """Local import starting with module_path should be relative."""
        module_path = 'github.com/user/myproject'
        known_files = {'pkg/helper.go', 'pkg/util.go'}

        resolved, is_external = resolve_go_import(
            'github.com/user/myproject/pkg',
            '.',
            known_files,
            module_path
        )
        assert resolved == 'pkg'
        assert is_external is False

    def test_local_package_with_nested_files(self):
        """Local package should match when .go files exist in subdirectory."""
        module_path = 'myapp'
        known_files = {'utils/helper.go', 'utils/sort.go'}

        resolved, is_external = resolve_go_import(
            'myapp/utils',
            '.',
            known_files,
            module_path
        )
        assert resolved == 'utils'
        assert is_external is False

    def test_stdlib_import(self):
        """Standard library imports (no dots) should be external."""
        module_path = 'github.com/user/myproject'
        known_files = {'main.go'}

        resolved, is_external = resolve_go_import('fmt', '.', known_files, module_path)
        assert resolved == 'fmt'
        assert is_external is True

        resolved, is_external = resolve_go_import('io', '.', known_files, module_path)
        assert resolved == 'io'
        assert is_external is True

    def test_third_party_import(self):
        """Third-party imports (dots but not module_path) should be external."""
        module_path = 'github.com/user/myproject'
        known_files = {'main.go'}

        resolved, is_external = resolve_go_import(
            'github.com/other/package',
            '.',
            known_files,
            module_path
        )
        assert resolved == 'github.com/other/package'
        assert is_external is True

    def test_local_import_no_matching_files(self):
        """Local import with no matching .go files should still be marked external."""
        module_path = 'myapp'
        known_files = {'main.go'}

        resolved, is_external = resolve_go_import(
            'myapp/missing',
            '.',
            known_files,
            module_path
        )
        assert is_external is True

    def test_no_module_path(self):
        """With no module_path, third-party and stdlib are both external."""
        known_files = {'main.go', 'utils.go'}

        resolved, is_external = resolve_go_import('fmt', '.', known_files, None)
        assert is_external is True

        resolved, is_external = resolve_go_import('github.com/other/pkg', '.', known_files, None)
        assert is_external is True


# =============================================================================
# resolve_rust_mod tests
# =============================================================================

class TestResolveRustMod:
    """Tests for resolve_rust_mod()."""

    def test_sibling_file_resolution(self):
        """Mod foo should resolve to foo.rs (sibling file)."""
        known_files = {'src/main.rs', 'src/lib.rs', 'src/utils.rs'}

        resolved, is_external = resolve_rust_mod('utils', 'src/lib.rs', 'src', known_files)
        assert resolved == 'src/utils.rs'
        assert is_external is False

    def test_directory_with_mod_rs(self):
        """Mod foo should resolve to foo/mod.rs (directory module)."""
        known_files = {'src/main.rs', 'src/config/mod.rs'}

        resolved, is_external = resolve_rust_mod('config', 'src/main.rs', 'src', known_files)
        assert resolved == 'src/config/mod.rs'
        assert is_external is False

    def test_sibling_precedence_over_directory(self):
        """Sibling .rs file should take precedence over directory/mod.rs."""
        known_files = {'src/main.rs', 'src/utils.rs', 'src/utils/mod.rs'}

        resolved, is_external = resolve_rust_mod('utils', 'src/main.rs', 'src', known_files)
        assert resolved == 'src/utils.rs'
        assert is_external is False

    def test_unresolved_mod_returns_candidate(self):
        """Unresolved mod should return candidate path (still returns False)."""
        known_files = {'src/main.rs'}

        resolved, is_external = resolve_rust_mod('missing', 'src/main.rs', 'src', known_files)
        assert resolved == 'src/missing.rs'
        assert is_external is False

    def test_nested_module_declaration(self):
        """Module in nested directory should resolve relatively."""
        known_files = {'src/main.rs', 'src/db/pool.rs', 'src/db/mod.rs'}

        resolved, is_external = resolve_rust_mod('pool', 'src/db/mod.rs', 'src/db', known_files)
        assert resolved == 'src/db/pool.rs'
        assert is_external is False


# =============================================================================
# build_cs_namespace_map tests
# =============================================================================

class TestBuildCsNamespaceMap:
    """Tests for build_cs_namespace_map() with real temp files."""

    def test_single_namespace_single_file(self, tmp_path):
        """Single .cs file with namespace should map correctly."""
        cs_file = tmp_path / "User.cs"
        cs_file.write_text("namespace MyApp.Models { class User {} }")

        known_files = {'User.cs'}
        ns_map, class_map = build_cs_namespace_map(str(tmp_path), known_files)

        assert 'MyApp.Models' in ns_map
        assert ns_map['MyApp.Models'] == ['User.cs']
        assert 'MyApp.Models.User' in class_map
        assert class_map['MyApp.Models.User'] == 'User.cs'

    def test_multiple_files_same_namespace(self, tmp_path):
        """Multiple files in same namespace should list all files."""
        (tmp_path / "User.cs").write_text("namespace MyApp.Models { class User {} }")
        (tmp_path / "Product.cs").write_text("namespace MyApp.Models { class Product {} }")

        known_files = {'User.cs', 'Product.cs'}
        ns_map, class_map = build_cs_namespace_map(str(tmp_path), known_files)

        assert 'MyApp.Models' in ns_map
        assert set(ns_map['MyApp.Models']) == {'Product.cs', 'User.cs'}
        assert class_map['MyApp.Models.User'] == 'User.cs'
        assert class_map['MyApp.Models.Product'] == 'Product.cs'

    def test_nested_namespaces(self, tmp_path):
        """Different nested namespaces should be separate keys."""
        (tmp_path / "A.cs").write_text("namespace App.Core { }")
        (tmp_path / "B.cs").write_text("namespace App.Models { }")
        (tmp_path / "C.cs").write_text("namespace App.Utils { }")

        known_files = {'A.cs', 'B.cs', 'C.cs'}
        ns_map, class_map = build_cs_namespace_map(str(tmp_path), known_files)

        assert ns_map['App.Core'] == ['A.cs']
        assert ns_map['App.Models'] == ['B.cs']
        assert ns_map['App.Utils'] == ['C.cs']

    def test_directory_structure(self, tmp_path):
        """Files in subdirectories should be tracked with full paths."""
        models_dir = tmp_path / "Models"
        models_dir.mkdir()
        (models_dir / "User.cs").write_text("namespace MyApp.Models { }")
        (models_dir / "Product.cs").write_text("namespace MyApp.Models { }")

        known_files = {'Models/User.cs', 'Models/Product.cs'}
        ns_map, class_map = build_cs_namespace_map(str(tmp_path), known_files)

        assert set(ns_map['MyApp.Models']) == {'Models/Product.cs', 'Models/User.cs'}
        assert class_map['MyApp.Models.User'] == 'Models/User.cs'

    def test_non_cs_files_ignored(self, tmp_path):
        """Non-.cs files should be ignored."""
        (tmp_path / "something.txt").write_text("namespace MyApp { }")
        (tmp_path / "code.cs").write_text("namespace MyApp.Models { }")

        known_files = {'something.txt', 'code.cs'}
        ns_map, class_map = build_cs_namespace_map(str(tmp_path), known_files)

        assert 'MyApp.Models' in ns_map
        assert 'MyApp' not in ns_map  # namespace from .txt is ignored
        assert ns_map['MyApp.Models'] == ['code.cs']


# =============================================================================
# resolve_cs_using tests
# =============================================================================

class TestResolveCsUsing:
    """Tests for resolve_cs_using()."""

    def test_system_namespace_external(self):
        """System namespaces should be marked external."""
        known_files = {'Models/User.cs'}

        resolved, is_external = resolve_cs_using('System', '.', known_files)
        assert is_external is True

        resolved, is_external = resolve_cs_using('System.Collections', '.', known_files)
        assert is_external is True

        resolved, is_external = resolve_cs_using('Microsoft.Win32', '.', known_files)
        assert is_external is True

    def test_exact_namespace_match_via_map(self):
        """Exact namespace match via ns_map."""
        ns_map = {'MyApp.Models': ['Models/User.cs', 'Models/Product.cs']}
        class_map = {}

        resolved, is_external = resolve_cs_using('MyApp.Models', '.', set(), ns_map, class_map)
        assert resolved == ['Models/User.cs', 'Models/Product.cs']
        assert is_external is False

    def test_class_map_match(self):
        """Class map should match Namespace.ClassName."""
        ns_map = {}
        class_map = {'MyApp.Models.User': 'Models/User.cs'}

        resolved, is_external = resolve_cs_using('MyApp.Models.User', '.', set(), ns_map, class_map)
        assert resolved == ['Models/User.cs']
        assert is_external is False

    def test_parent_namespace_children(self):
        """Exact match takes priority — children are only found when no exact match exists."""
        ns_map = {
            'App.Data': ['Data/Db.cs'],
            'App.Data.Sql': ['Data/SqlProvider.cs'],
        }
        class_map = {}

        # Exact match for 'App.Data' exists → returns only its files, not children
        resolved, is_external = resolve_cs_using('App.Data', '.', set(), ns_map, class_map)
        assert resolved == ['Data/Db.cs']
        assert is_external is False

    def test_parent_namespace_no_exact_finds_children(self):
        """When no exact match, prefix search finds child namespaces."""
        ns_map = {
            'App.Data.Sql': ['Data/SqlProvider.cs'],
            'App.Data.Orm': ['Data/OrmProvider.cs'],
        }
        class_map = {}

        resolved, is_external = resolve_cs_using('App.Data', '.', set(), ns_map, class_map)
        assert 'Data/SqlProvider.cs' in resolved
        assert 'Data/OrmProvider.cs' in resolved
        assert is_external is False

    def test_path_heuristic_fallback_file(self):
        """Path heuristics should find .cs file by namespace parts."""
        known_files = {'App/Models/User.cs'}

        resolved, is_external = resolve_cs_using('App.Models.User', '.', known_files)
        assert resolved == ['App/Models/User.cs']
        assert is_external is False

    def test_path_heuristic_fallback_directory(self):
        """Path heuristics should find directory of .cs files."""
        known_files = {'Models/User.cs', 'Models/Product.cs'}

        resolved, is_external = resolve_cs_using('Models', '.', known_files)
        assert set(resolved) == {'Models/User.cs', 'Models/Product.cs'}
        assert is_external is False

    def test_hyphen_underscore_fuzzy_match(self):
        """Should match directories with hyphens vs underscores."""
        known_files = {'my-models/User.cs'}

        resolved, is_external = resolve_cs_using('my_models.User', '.', known_files)
        assert resolved == ['my-models/User.cs']
        assert is_external is False

    def test_unresolved_external(self):
        """Unresolved using should be marked external."""
        known_files = set()

        resolved, is_external = resolve_cs_using('UnknownNamespace', '.', known_files)
        assert is_external is True


# =============================================================================
# resolve_swift_import tests
# =============================================================================

class TestResolveSwiftImport:
    """Tests for resolve_swift_import()."""

    def test_system_module_external(self):
        """System modules should be marked external."""
        known_files = {'App.swift'}

        resolved, is_external = resolve_swift_import('Foundation', 'App.swift', '.', known_files)
        assert resolved == 'Foundation'
        assert is_external is True

        resolved, is_external = resolve_swift_import('UIKit', 'App.swift', '.', known_files)
        assert resolved == 'UIKit'
        assert is_external is True

    def test_local_swift_file_match(self):
        """Local .swift file should match module name."""
        known_files = {'App.swift', 'Models.swift', 'Utils.swift'}

        resolved, is_external = resolve_swift_import('Utils', 'App.swift', '.', known_files)
        assert resolved == 'Utils.swift'
        assert is_external is False

    def test_nested_module_path(self):
        """Nested module path should map to file."""
        known_files = {'Models/User.swift', 'App.swift'}

        resolved, is_external = resolve_swift_import('Models.User', 'App.swift', '.', known_files)
        assert resolved == 'Models/User.swift'
        assert is_external is False

    def test_directory_of_swift_files(self):
        """Module name matching directory of .swift files."""
        known_files = {'Utils/Helper.swift', 'Utils/Math.swift', 'App.swift'}

        resolved, is_external = resolve_swift_import('Utils', 'App.swift', '.', known_files)
        assert resolved == 'Utils'
        assert is_external is False

    def test_basename_fallback(self):
        """Should fallback to matching base name in any directory."""
        known_files = {'src/Helper.swift', 'App.swift'}

        resolved, is_external = resolve_swift_import('Helper', 'App.swift', '.', known_files)
        assert resolved == 'src/Helper.swift'
        assert is_external is False

    def test_unresolved_external(self):
        """Unresolved import should be marked external."""
        known_files = {'App.swift'}

        resolved, is_external = resolve_swift_import('UnknownModule', 'App.swift', '.', known_files)
        assert resolved == 'UnknownModule'
        assert is_external is True


# =============================================================================
# resolve_ruby_require tests
# =============================================================================

class TestResolveRubyRequire:
    """Tests for resolve_ruby_require()."""

    def test_require_relative_from_same_dir(self):
        """require_relative from same directory."""
        known_files = {'app.rb', 'utils.rb'}

        resolved, is_external = resolve_ruby_require('utils', 'app.rb', '.', known_files, relative=True)
        assert resolved == 'utils.rb'
        assert is_external is False

    def test_require_relative_with_extension(self):
        """require_relative with explicit .rb extension."""
        known_files = {'app.rb', 'helpers.rb'}

        resolved, is_external = resolve_ruby_require('helpers.rb', 'app.rb', '.', known_files, relative=True)
        assert resolved == 'helpers.rb'
        assert is_external is False

    def test_require_relative_parent_directory(self):
        """require_relative from parent directory."""
        known_files = {'lib/app.rb', 'helper.rb'}

        resolved, is_external = resolve_ruby_require('../helper', 'lib/app.rb', 'lib', known_files, relative=True)
        assert resolved == 'helper.rb'
        assert is_external is False

    def test_require_stdlib_external(self):
        """require for stdlib should be marked external."""
        known_files = {'app.rb'}

        resolved, is_external = resolve_ruby_require('json', 'app.rb', '.', known_files, relative=False)
        assert resolved == 'json'
        assert is_external is True

        resolved, is_external = resolve_ruby_require('yaml', 'app.rb', '.', known_files, relative=False)
        assert resolved == 'yaml'
        assert is_external is True

    def test_require_nested_stdlib(self):
        """require for nested stdlib paths."""
        known_files = {'app.rb'}

        resolved, is_external = resolve_ruby_require('net/http', 'app.rb', '.', known_files, relative=False)
        assert resolved == 'net/http'
        assert is_external is True

    def test_require_local_file(self):
        """require for local file without relative=True."""
        known_files = {'utils.rb', 'app.rb'}

        resolved, is_external = resolve_ruby_require('utils', 'app.rb', '.', known_files, relative=False)
        assert resolved == 'utils.rb'
        assert is_external is False

    def test_require_relative_unresolved(self):
        """Unresolved require_relative still returns candidate (False)."""
        known_files = {'app.rb'}

        resolved, is_external = resolve_ruby_require('missing', 'app.rb', '.', known_files, relative=True)
        assert resolved == 'missing.rb'
        assert is_external is False

    def test_require_gem_external(self):
        """require for unknown gem/package should be external."""
        known_files = {'app.rb'}

        resolved, is_external = resolve_ruby_require('rails', 'app.rb', '.', known_files, relative=False)
        assert resolved == 'rails'
        assert is_external is True


# =============================================================================
# parse_go_mod tests
# =============================================================================

class TestParseGoMod:
    """Tests for parse_go_mod() with real temp files."""

    def test_parse_go_mod_basic(self, tmp_path):
        """Basic go.mod parsing."""
        go_mod = tmp_path / "go.mod"
        go_mod.write_text("module github.com/user/myproject\n")

        result = parse_go_mod(str(tmp_path))
        assert result == 'github.com/user/myproject'

    def test_parse_go_mod_with_other_lines(self, tmp_path):
        """go.mod with multiple lines should extract module correctly."""
        go_mod = tmp_path / "go.mod"
        go_mod.write_text(
            "module github.com/user/myproject\n"
            "go 1.18\n"
            "require (\n"
            "  other/pkg v1.0.0\n"
            ")\n"
        )

        result = parse_go_mod(str(tmp_path))
        assert result == 'github.com/user/myproject'

    def test_parse_go_mod_with_whitespace(self, tmp_path):
        """go.mod with extra whitespace."""
        go_mod = tmp_path / "go.mod"
        go_mod.write_text("module   github.com/user/myproject   \n")

        result = parse_go_mod(str(tmp_path))
        assert result == 'github.com/user/myproject'

    def test_parse_go_mod_not_found(self, tmp_path):
        """Missing go.mod should return None."""
        result = parse_go_mod(str(tmp_path))
        assert result is None

    def test_parse_go_mod_no_module_line(self, tmp_path):
        """go.mod without module line should return None."""
        go_mod = tmp_path / "go.mod"
        go_mod.write_text("go 1.18\n")

        result = parse_go_mod(str(tmp_path))
        assert result is None

    def test_parse_go_mod_module_line_middle(self, tmp_path):
        """Module declaration not on first line should still be found."""
        go_mod = tmp_path / "go.mod"
        go_mod.write_text(
            "// Some comment\n"
            "module github.com/user/myproject\n"
            "go 1.18\n"
        )

        result = parse_go_mod(str(tmp_path))
        assert result == 'github.com/user/myproject'


# =============================================================================
# Parameterized tests for common patterns
# =============================================================================

class TestResolvePatterns:
    """Tests for common resolution patterns across languages."""

    @pytest.mark.parametrize("import_path,is_external_expected", [
        ('react', True),
        ('lodash', True),
        ('@scope/package', True),
        ('@babel/core', True),
    ])
    def test_all_bare_imports_external(self, import_path, is_external_expected):
        """All bare imports in JS should be external."""
        known_files = {'src/app.js'}
        _, is_external = resolve_js_import(import_path, 'src/app.js', 'src', known_files)
        assert is_external == is_external_expected

    @pytest.mark.parametrize("req_path,relative,is_external_expected", [
        ('json', False, True),
        ('yaml', False, True),
        ('net/http', False, True),
        ('rails', False, True),
    ])
    def test_ruby_stdlib_external(self, req_path, relative, is_external_expected):
        """Ruby stdlib requires should be external."""
        known_files = {'app.rb'}
        _, is_external = resolve_ruby_require(req_path, 'app.rb', '.', known_files, relative)
        assert is_external == is_external_expected

    @pytest.mark.parametrize("module,is_external_expected", [
        ('os', True),
        ('sys', True),
        ('json', True),
        ('pathlib', True),
        ('typing', True),
    ])
    def test_python_stdlib_external(self, module, is_external_expected):
        """Python stdlib modules should be external."""
        known_files = {'main.py'}
        _, is_external = resolve_py_import(module, 'main.py', '.', known_files)
        assert is_external == is_external_expected
