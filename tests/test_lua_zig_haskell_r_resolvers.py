"""Unit tests for Lua, Zig, Haskell, and R resolver functions."""

import os
import pytest
from parsers import (
    resolve_lua_require,
    resolve_zig_import,
    resolve_haskell_import,
    resolve_r_source,
)


# =============================================================================
# resolve_lua_require tests
# =============================================================================

class TestResolveLuaRequire:
    """Tests for resolve_lua_require()."""

    def test_stdlib_external(self):
        known_files = {'main.lua'}
        resolved, is_external = resolve_lua_require(
            'math', 'main.lua', '.', known_files
        )
        assert is_external is True

    def test_love_external(self):
        known_files = {'main.lua'}
        resolved, is_external = resolve_lua_require(
            'love', 'main.lua', '.', known_files
        )
        assert is_external is True

    def test_cjson_external(self):
        known_files = {'main.lua'}
        resolved, is_external = resolve_lua_require(
            'cjson', 'main.lua', '.', known_files
        )
        assert is_external is True

    def test_local_dot_path_resolves(self):
        known_files = {
            'main.lua',
            os.path.join('models', 'user.lua'),
        }
        resolved, is_external = resolve_lua_require(
            'models.user', 'main.lua', '.', known_files
        )
        assert resolved == os.path.join('models', 'user.lua')
        assert is_external is False

    def test_init_lua_resolves(self):
        known_files = {
            'main.lua',
            os.path.join('models', 'init.lua'),
        }
        resolved, is_external = resolve_lua_require(
            'models', 'main.lua', '.', known_files
        )
        assert resolved == os.path.join('models', 'init.lua')
        assert is_external is False

    def test_unresolved_external(self):
        known_files = {'main.lua'}
        resolved, is_external = resolve_lua_require(
            'unknown_module', 'main.lua', '.', known_files
        )
        assert is_external is True


# =============================================================================
# resolve_zig_import tests
# =============================================================================

class TestResolveZigImport:
    """Tests for resolve_zig_import()."""

    def test_std_external(self):
        known_files = {'main.zig'}
        resolved, is_external = resolve_zig_import(
            'std', 'main.zig', '.', known_files
        )
        assert is_external is True

    def test_builtin_external(self):
        known_files = {'main.zig'}
        resolved, is_external = resolve_zig_import(
            'builtin', 'main.zig', '.', known_files
        )
        assert is_external is True

    def test_local_file_resolves(self):
        known_files = {
            'main.zig',
            os.path.join('models', 'user.zig'),
        }
        resolved, is_external = resolve_zig_import(
            'models/user.zig', 'main.zig', '.', known_files
        )
        assert resolved == os.path.join('models', 'user.zig')
        assert is_external is False

    def test_relative_import_resolves(self):
        known_files = {
            os.path.join('models', 'user.zig'),
            os.path.join('services', 'user_service.zig'),
        }
        resolved, is_external = resolve_zig_import(
            '../models/user.zig',
            os.path.join('services', 'user_service.zig'),
            '.', known_files
        )
        assert resolved == os.path.join('models', 'user.zig')
        assert is_external is False

    def test_unresolved_external(self):
        known_files = {'main.zig'}
        resolved, is_external = resolve_zig_import(
            'unknown.zig', 'main.zig', '.', known_files
        )
        assert is_external is True


# =============================================================================
# resolve_haskell_import tests
# =============================================================================

class TestResolveHaskellImport:
    """Tests for resolve_haskell_import()."""

    def test_prelude_external(self):
        known_files = {'Main.hs'}
        resolved, is_external = resolve_haskell_import(
            'Prelude', 'Main.hs', '.', known_files
        )
        assert is_external is True

    def test_data_list_external(self):
        known_files = {'Main.hs'}
        resolved, is_external = resolve_haskell_import(
            'Data.List', 'Main.hs', '.', known_files
        )
        assert is_external is True

    def test_system_io_external(self):
        known_files = {'Main.hs'}
        resolved, is_external = resolve_haskell_import(
            'System.IO', 'Main.hs', '.', known_files
        )
        assert is_external is True

    def test_control_monad_external(self):
        known_files = {'Main.hs'}
        resolved, is_external = resolve_haskell_import(
            'Control.Monad', 'Main.hs', '.', known_files
        )
        assert is_external is True

    def test_local_module_resolves(self):
        known_files = {
            'Main.hs',
            os.path.join('Models', 'User.hs'),
        }
        resolved, is_external = resolve_haskell_import(
            'Models.User', 'Main.hs', '.', known_files
        )
        assert resolved == os.path.join('Models', 'User.hs')
        assert is_external is False

    def test_src_prefix_resolves(self):
        known_files = {
            os.path.join('src', 'Models', 'User.hs'),
        }
        resolved, is_external = resolve_haskell_import(
            'Models.User', 'Main.hs', '.', known_files
        )
        assert resolved == os.path.join('src', 'Models', 'User.hs')
        assert is_external is False

    def test_basename_fallback(self):
        known_files = {
            os.path.join('custom', 'path', 'User.hs'),
        }
        resolved, is_external = resolve_haskell_import(
            'MyApp.User', 'Main.hs', '.', known_files
        )
        assert resolved == os.path.join('custom', 'path', 'User.hs')
        assert is_external is False

    def test_unresolved_external(self):
        known_files = {'Main.hs'}
        resolved, is_external = resolve_haskell_import(
            'SomeUnknown.Module', 'Main.hs', '.', known_files
        )
        assert is_external is True


# =============================================================================
# resolve_r_source tests
# =============================================================================

class TestResolveRSource:
    """Tests for resolve_r_source()."""

    def test_resolve_relative(self):
        known_files = {'main.R', os.path.join('models', 'user.R')}
        resolved, is_external = resolve_r_source(
            'models/user.R', 'main.R', '.', known_files
        )
        assert resolved == os.path.join('models', 'user.R')
        assert is_external is False

    def test_resolve_from_root(self):
        known_files = {'config.R', os.path.join('src', 'app.R')}
        resolved, is_external = resolve_r_source(
            'config.R', os.path.join('src', 'app.R'), '.', known_files
        )
        assert resolved == 'config.R'
        assert is_external is False

    def test_resolve_parent_relative(self):
        known_files = {
            os.path.join('models', 'user.R'),
            os.path.join('services', 'user_service.R'),
        }
        resolved, is_external = resolve_r_source(
            '../models/user.R',
            os.path.join('services', 'user_service.R'),
            '.', known_files
        )
        assert resolved == os.path.join('models', 'user.R')
        assert is_external is False
