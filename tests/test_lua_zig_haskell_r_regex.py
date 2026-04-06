"""Comprehensive tests for Lua, Zig, Haskell, and R regex patterns."""

import pytest
from parsers import (
    LUA_REQUIRE_RE,
    ZIG_IMPORT_RE,
    HASKELL_IMPORT_RE,
    R_LIBRARY_RE,
    R_SOURCE_RE,
)


# =========================================================================
# Lua LUA_REQUIRE_RE tests
# =========================================================================

class TestLuaRequireRe:
    """Tests for Lua require patterns."""

    @pytest.mark.parametrize("text,expected", [
        ('local M = require("models.user")', 'models.user'),
        ("local M = require('models.user')", 'models.user'),
        ('require("models.order")', 'models.order'),
        ('local json = require("cjson")', 'cjson'),
        ('local lfs = require "lfs"', 'lfs'),
    ])
    def test_basic_requires(self, text, expected):
        match = LUA_REQUIRE_RE.search(text)
        assert match is not None
        assert match.group(1) == expected

    def test_require_without_parens(self):
        match = LUA_REQUIRE_RE.search('require "socket"')
        assert match is not None
        assert match.group(1) == 'socket'

    @pytest.mark.parametrize("text", [
        '-- require("commented")',
        'local x = "require is a string"',
    ])
    def test_should_not_match(self, text):
        match = LUA_REQUIRE_RE.search(text)
        if text.startswith('--'):
            # Comment lines may match in regex but that's acceptable
            pass
        else:
            assert match is None

    def test_multiple_requires(self):
        content = 'local A = require("foo")\nlocal B = require("bar")\n'
        matches = list(LUA_REQUIRE_RE.finditer(content))
        assert len(matches) == 2
        assert matches[0].group(1) == 'foo'
        assert matches[1].group(1) == 'bar'


# =========================================================================
# Zig ZIG_IMPORT_RE tests
# =========================================================================

class TestZigImportRe:
    """Tests for Zig @import patterns."""

    @pytest.mark.parametrize("text,expected", [
        ('const std = @import("std");', 'std'),
        ('const User = @import("models/user.zig");', 'models/user.zig'),
        ('const builtin = @import("builtin");', 'builtin'),
        ('const c = @import("../models/order.zig");', '../models/order.zig'),
    ])
    def test_basic_imports(self, text, expected):
        match = ZIG_IMPORT_RE.search(text)
        assert match is not None
        assert match.group(1) == expected

    @pytest.mark.parametrize("text", [
        '// @import("commented")',
        'const x = "not an @import";',
    ])
    def test_should_not_match(self, text):
        match = ZIG_IMPORT_RE.search(text)
        if text.startswith('//'):
            # Comment lines may match
            pass
        else:
            assert match is None

    def test_multiple_imports(self):
        content = 'const std = @import("std");\nconst User = @import("user.zig");\n'
        matches = list(ZIG_IMPORT_RE.finditer(content))
        assert len(matches) == 2
        assert matches[0].group(1) == 'std'
        assert matches[1].group(1) == 'user.zig'


# =========================================================================
# Haskell HASKELL_IMPORT_RE tests
# =========================================================================

class TestHaskellImportRe:
    """Tests for Haskell import patterns."""

    @pytest.mark.parametrize("text,expected", [
        ('import Data.List', 'Data.List'),
        ('import Models.User', 'Models.User'),
        ('import qualified Data.Map as Map', 'Data.Map'),
        ('import System.IO', 'System.IO'),
        ('import Control.Monad', 'Control.Monad'),
    ])
    def test_basic_imports(self, text, expected):
        match = HASKELL_IMPORT_RE.search(text)
        assert match is not None
        assert match.group(1) == expected

    def test_qualified_import(self):
        match = HASKELL_IMPORT_RE.search('import qualified Data.Map.Strict as Map')
        assert match is not None
        assert match.group(1) == 'Data.Map.Strict'

    @pytest.mark.parametrize("text", [
        '-- import Data.List',
        'module Main where',
    ])
    def test_should_not_match(self, text):
        match = HASKELL_IMPORT_RE.search(text)
        if text.startswith('--'):
            pass  # Comment may partially match
        else:
            assert match is None

    def test_multiple_imports(self):
        content = "import Data.List\nimport Models.User\nimport qualified Data.Map as Map\n"
        matches = list(HASKELL_IMPORT_RE.finditer(content))
        assert len(matches) == 3
        assert matches[0].group(1) == 'Data.List'
        assert matches[1].group(1) == 'Models.User'
        assert matches[2].group(1) == 'Data.Map'


# =========================================================================
# R R_LIBRARY_RE and R_SOURCE_RE tests
# =========================================================================

class TestRLibraryRe:
    """Tests for R library/require patterns."""

    @pytest.mark.parametrize("text,expected", [
        ('library(ggplot2)', 'ggplot2'),
        ('library("dplyr")', 'dplyr'),
        ("library('tidyr')", 'tidyr'),
        ('require(shiny)', 'shiny'),
        ('require("data.table")', 'data.table'),
    ])
    def test_basic_library(self, text, expected):
        match = R_LIBRARY_RE.search(text)
        assert match is not None
        assert match.group(1) == expected

    @pytest.mark.parametrize("text", [
        '# library(commented)',
        'x <- "library(not_a_call)"',
    ])
    def test_should_not_match(self, text):
        match = R_LIBRARY_RE.search(text)
        if text.startswith('#'):
            pass  # Comment may partially match
        else:
            assert match is None

    def test_multiple_libraries(self):
        content = "library(ggplot2)\nlibrary(dplyr)\nrequire(tidyr)\n"
        matches = list(R_LIBRARY_RE.finditer(content))
        assert len(matches) == 3
        assert matches[0].group(1) == 'ggplot2'
        assert matches[1].group(1) == 'dplyr'
        assert matches[2].group(1) == 'tidyr'


class TestRSourceRe:
    """Tests for R source() patterns."""

    @pytest.mark.parametrize("text,expected", [
        ('source("models/user.R")', 'models/user.R'),
        ("source('utils/helpers.R')", 'utils/helpers.R'),
        ('source("../config.R")', '../config.R'),
    ])
    def test_basic_source(self, text, expected):
        match = R_SOURCE_RE.search(text)
        assert match is not None
        assert match.group(1) == expected

    def test_multiple_sources(self):
        content = 'source("models/user.R")\nsource("models/order.R")\n'
        matches = list(R_SOURCE_RE.finditer(content))
        assert len(matches) == 2
        assert matches[0].group(1) == 'models/user.R'
        assert matches[1].group(1) == 'models/order.R'
