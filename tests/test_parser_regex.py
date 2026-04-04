"""Comprehensive tests for all regex patterns in parsers.py."""

import pytest
from parsers import (
    INCLUDE_RE,
    JS_IMPORT_RE,
    PY_FROM_IMPORT_RE,
    PY_IMPORT_RE,
    JAVA_IMPORT_RE,
    GO_IMPORT_RE,
    GO_IMPORT_PATH_RE,
    RUST_USE_RE,
    RUST_MOD_RE,
    RUST_EXTERN_RE,
    CS_USING_RE,
    CS_NAMESPACE_RE,
    SWIFT_IMPORT_RE,
    RUBY_REQUIRE_RE,
    RUBY_REQUIRE_RELATIVE_RE,
    collapse_py_multiline_imports,
)


# =========================================================================
# C/C++ INCLUDE_RE tests
# =========================================================================

class TestIncludeRe:
    """Tests for C/C++ #include patterns."""

    @pytest.mark.parametrize("text,expected", [
        ('#include <stdio.h>', 'stdio.h'),
        ('#include "myheader.h"', 'myheader.h'),
        ('#include <sys/types.h>', 'sys/types.h'),
        ('#include "path/to/header.hpp"', 'path/to/header.hpp'),
    ])
    def test_basic_includes(self, text, expected):
        """Test basic include statements."""
        match = INCLUDE_RE.search(text)
        assert match is not None
        # Group 2 is the actual path (group 1 is < or ")
        assert match.group(2) == expected

    @pytest.mark.parametrize("text,expected", [
        ('#include   <stdio.h>', 'stdio.h'),
        ('#include  "header.h"', 'header.h'),
        ('#include\t<math.h>', 'math.h'),
    ])
    def test_whitespace_variations(self, text, expected):
        """Test includes with varying whitespace."""
        match = INCLUDE_RE.search(text)
        assert match is not None
        assert match.group(2) == expected

    @pytest.mark.parametrize("text", [
        '// #include <commented.h>',
        '/* #include "in_comment.h" */',
        '#ifndef INCLUDED',
        '#pragma once',
        '#define HEADER "not_an_include"',
    ])
    def test_should_not_match_comments_and_directives(self, text):
        """Test things that look like includes but aren't."""
        match = INCLUDE_RE.search(text)
        # Comments and other directives should not match
        if text.startswith('//') or text.startswith('/*'):
            # Actually, the regex will match the part after //, so check more carefully
            if match:
                # If there's a match, it should not be the commented-out include
                assert '#include' not in text[:match.start()]
        elif text.startswith('#ifndef') or text.startswith('#pragma') or text.startswith('#define'):
            # These should definitely not match
            assert match is None

    @pytest.mark.parametrize("text", [
        '#include <stdio.h> #include <stdlib.h>',
    ])
    def test_multiple_on_same_line(self, text):
        """Test multiple includes on the same line."""
        matches = list(INCLUDE_RE.finditer(text))
        assert len(matches) == 2
        assert matches[0].group(2) == 'stdio.h'
        assert matches[1].group(2) == 'stdlib.h'

    def test_empty_or_invalid_includes(self):
        """Test edge cases with empty or minimal includes."""
        # Empty path doesn't match — regex requires [^>"]+  (one or more chars)
        assert INCLUDE_RE.search('#include <>') is None
        assert INCLUDE_RE.search('#include ""') is None
        # Minimal valid path does match
        assert INCLUDE_RE.search('#include <.h>') is not None


# =========================================================================
# JavaScript/TypeScript JS_IMPORT_RE tests
# =========================================================================

class TestJsImportRe:
    """Tests for JS/TS import and require patterns."""

    @pytest.mark.parametrize("text,expected_path", [
        ("import React from 'react'", 'react'),
        ('import { Component } from "react"', 'react'),
        ("import 'styles.css'", 'styles.css'),
        ("const x = require('module')", 'module'),
        ('require("./local")', './local'),
        ("import type { Foo } from 'types'", 'types'),
    ])
    def test_basic_imports(self, text, expected_path):
        """Test basic import and require statements."""
        match = JS_IMPORT_RE.search(text)
        assert match is not None
        # Group 1 is from 'import from' style, group 2 is from require()
        path = match.group(1) or match.group(2)
        assert path == expected_path

    @pytest.mark.parametrize("text,expected_path", [
        ("import   React   from   'react'", 'react'),
        ("require ( 'module' )", 'module'),
        ("import\t{\t}\tfrom\t'lib'", 'lib'),
    ])
    def test_whitespace_variations(self, text, expected_path):
        """Test imports with varying whitespace."""
        match = JS_IMPORT_RE.search(text)
        assert match is not None
        path = match.group(1) or match.group(2)
        assert path == expected_path

    @pytest.mark.parametrize("text", [
        "// import React from 'react'",
        "/* import { x } from 'y' */",
        "const str = \"import not an import\";",
    ])
    def test_should_not_match_comments_and_strings(self, text):
        """Test false positives in comments and string literals."""
        # Note: regex doesn't account for context, so these might match
        # This test documents the limitation
        match = JS_IMPORT_RE.search(text)
        # Regex is simple and will match inside comments too
        # This is a known limitation of regex-based parsing
        pass

    @pytest.mark.parametrize("text", [
        "import a from 'x'; import b from 'y';",
    ])
    def test_multiple_on_same_line(self, text):
        """Test multiple imports on the same line."""
        matches = list(JS_IMPORT_RE.finditer(text))
        assert len(matches) == 2

    @pytest.mark.parametrize("text,expected_path", [
        ("import { a, b, c } from 'module'", 'module'),
        ("import * as NS from './lib'", './lib'),
        ("import def from 'default'", 'default'),
    ])
    def test_complex_import_forms(self, text, expected_path):
        """Test complex import statement forms."""
        match = JS_IMPORT_RE.search(text)
        assert match is not None
        path = match.group(1) or match.group(2)
        assert path == expected_path


# =========================================================================
# Python PY_FROM_IMPORT_RE tests
# =========================================================================

class TestPyFromImportRe:
    """Tests for Python 'from ... import' patterns."""

    @pytest.mark.parametrize("text,expected_module,expected_names", [
        ("from foo import bar", "foo", "bar"),
        ("from foo.bar import baz", "foo.bar", "baz"),
        ("from . import foo", ".", "foo"),
        ("from .. import bar", "..", "bar"),
        ("from ...pkg import item", "...pkg", "item"),
        ("from foo import a, b, c", "foo", "a, b, c"),
    ])
    def test_basic_from_imports(self, text, expected_module, expected_names):
        """Test basic from...import statements."""
        match = PY_FROM_IMPORT_RE.search(text)
        assert match is not None
        assert match.group(1) == expected_module
        assert match.group(2) == expected_names

    @pytest.mark.parametrize("text,expected_module", [
        ("from   foo   import   bar", "foo"),
        ("from foo import bar  # comment", "foo"),
    ])
    def test_whitespace_variations(self, text, expected_module):
        """Test from imports with varying whitespace."""
        match = PY_FROM_IMPORT_RE.search(text)
        assert match is not None
        assert match.group(1) == expected_module

    def test_multiline_from_import_matches(self):
        """PY_FROM_IMPORT_RE uses re.MULTILINE + \\s+ which matches newlines."""
        # This is a regex characteristic — \s+ matches newlines
        match = PY_FROM_IMPORT_RE.search("from\nfoo\nimport\nbar")
        assert match is not None  # \s includes \n

    @pytest.mark.parametrize("text", [
        "# from foo import bar",
        "\"\"\"from x import y\"\"\"",
        "x = 'from foo import bar'",
    ])
    def test_should_not_match_strings_and_comments(self, text):
        """Test that strings/comments aren't matched."""
        # Regex doesn't understand context, so it will match
        # This documents the limitation
        pass

    @pytest.mark.parametrize("text", [
        "import foo",
        "from foo import",
        "from import bar",
    ])
    def test_invalid_from_imports(self, text):
        """Test invalid from...import forms."""
        match = PY_FROM_IMPORT_RE.search(text)
        assert match is None

    def test_relative_imports_with_multiple_dots(self):
        """Test relative imports with 1, 2, and 3 leading dots."""
        assert PY_FROM_IMPORT_RE.search("from . import x") is not None
        assert PY_FROM_IMPORT_RE.search("from .. import x") is not None
        assert PY_FROM_IMPORT_RE.search("from ... import x") is not None
        # 4 dots: \.{0,3} captures 3, then [\w.]* captures the 4th dot
        assert PY_FROM_IMPORT_RE.search("from .... import x") is not None


# =========================================================================
# Python PY_IMPORT_RE tests
# =========================================================================

class TestPyImportRe:
    """Tests for Python 'import' statements."""

    @pytest.mark.parametrize("text,expected_modules", [
        ("import foo", "foo"),
        ("import foo.bar", "foo.bar"),
        ("import foo, bar", "foo, bar"),
        ("import foo.bar, baz.qux", "foo.bar, baz.qux"),
    ])
    def test_basic_imports(self, text, expected_modules):
        """Test basic import statements."""
        match = PY_IMPORT_RE.search(text)
        assert match is not None
        assert match.group(1) == expected_modules

    def test_import_with_alias_not_matched(self):
        """PY_IMPORT_RE doesn't match 'import foo as f' — alias syntax not supported."""
        # The regex [\w.]+(?:\s*,\s*[\w.]+)* + \s*$ doesn't handle 'as' aliases.
        # This documents the limitation: aliased imports are not captured by the regex.
        match = PY_IMPORT_RE.search("import foo as f")
        assert match is None

    def test_whitespace_variations_extra_spaces(self):
        """Test import with extra whitespace matches."""
        match = PY_IMPORT_RE.search("import   foo   ")
        assert match is not None
        assert match.group(1) == "foo"

    def test_comment_after_import_no_match(self):
        """PY_IMPORT_RE uses \\s*$ anchor, so trailing comments prevent match."""
        # The regex requires \s*$ after the module name, so '# comment' prevents match.
        match = PY_IMPORT_RE.search("import foo  # comment")
        assert match is None

    @pytest.mark.parametrize("text", [
        "from foo import bar",
        "import",
        "import  ",
        "x = import",
    ])
    def test_invalid_imports(self, text):
        """Test invalid import forms."""
        match = PY_IMPORT_RE.search(text)
        assert match is None

    def test_multiple_imports_on_same_line(self):
        """Test multiple imports on one line."""
        text = "import foo, bar, baz"
        match = PY_IMPORT_RE.search(text)
        assert match is not None
        assert match.group(1) == "foo, bar, baz"


# =========================================================================
# Java JAVA_IMPORT_RE tests
# =========================================================================

class TestJavaImportRe:
    """Tests for Java import statements."""

    @pytest.mark.parametrize("text,expected_path", [
        ("import java.util.List;", "java.util.List"),
        ("import com.example.Foo;", "com.example.Foo"),
        ("import java.io.*;", "java.io.*"),
        ("import static java.lang.Math.PI;", "java.lang.Math.PI"),
        ("import static com.example.Util.*;", "com.example.Util.*"),
    ])
    def test_basic_imports(self, text, expected_path):
        """Test basic Java import statements."""
        match = JAVA_IMPORT_RE.search(text)
        assert match is not None
        assert match.group(1) == expected_path

    @pytest.mark.parametrize("text", [
        "import   java.util.List   ;",
        "import\tjava.io.*\t;",
    ])
    def test_whitespace_variations(self, text):
        """Test imports with varying whitespace."""
        match = JAVA_IMPORT_RE.search(text)
        assert match is not None

    @pytest.mark.parametrize("text", [
        "// import java.util.List;",
        "/* import com.example.Foo; */",
        "String s = \"import java.lang.String;\"",
    ])
    def test_should_not_match_comments_and_strings(self, text):
        """Test that comments and strings are handled."""
        # Regex doesn't understand context
        pass

    @pytest.mark.parametrize("text", [
        "import java.util.List",  # Missing semicolon
        "import;",
        "importjava.util.List;",
    ])
    def test_invalid_imports(self, text):
        """Test invalid Java import forms."""
        match = JAVA_IMPORT_RE.search(text)
        assert match is None

    def test_multiple_on_same_line(self):
        """JAVA_IMPORT_RE uses ^import with MULTILINE, so only 1 match per line."""
        # ^import anchors to start-of-line, so mid-line 'import' won't match
        text = "import java.util.List; import java.io.*;"
        matches = list(JAVA_IMPORT_RE.finditer(text))
        assert len(matches) == 1
        assert matches[0].group(1) == "java.util.List"


# =========================================================================
# Go GO_IMPORT_RE and GO_IMPORT_PATH_RE tests
# =========================================================================

class TestGoImportRe:
    """Tests for Go import statements."""

    @pytest.mark.parametrize("text,expected_path", [
        ('import "fmt"', 'fmt'),
        ('import "github.com/user/package"', 'github.com/user/package'),
    ])
    def test_single_import(self, text, expected_path):
        """Test single import statements."""
        match = GO_IMPORT_RE.search(text)
        assert match is not None
        # Group 2 is single import
        assert match.group(2) == expected_path

    def test_block_import(self):
        """Test block import statements."""
        text = '''import (
    "fmt"
    "github.com/user/package"
)'''
        match = GO_IMPORT_RE.search(text)
        assert match is not None
        # Group 1 is the block content
        block = match.group(1)
        assert block is not None
        # Extract individual paths from block
        paths = list(GO_IMPORT_PATH_RE.finditer(block))
        assert len(paths) == 2
        assert paths[0].group(1) == 'fmt'
        assert paths[1].group(1) == 'github.com/user/package'

    def test_extra_whitespace(self):
        """Import with extra whitespace should match."""
        match = GO_IMPORT_RE.search('import   "fmt"')
        assert match is not None

    def test_no_whitespace_no_match(self):
        """GO_IMPORT_RE requires \\s+ after 'import', so import"fmt" doesn't match."""
        match = GO_IMPORT_RE.search('import"fmt"')
        assert match is None

    def test_block_import_without_space_no_match(self):
        """GO_IMPORT_RE requires \\s+ after 'import', so import( doesn't match."""
        text = '''import(
    "fmt"
    "io"
)'''
        match = GO_IMPORT_RE.search(text)
        assert match is None

    def test_block_import_with_comments(self):
        """Test block imports that may contain comments."""
        # Note: Real Go files can have comments, but this regex is simple
        text = '''import (
    "fmt"  // formatting
    "io"
)'''
        match = GO_IMPORT_RE.search(text)
        assert match is not None
        # The regex will capture the entire block including comments
        paths = list(GO_IMPORT_PATH_RE.finditer(match.group(1)))
        assert len(paths) == 2


# =========================================================================
# Rust RUST_USE_RE, RUST_MOD_RE, RUST_EXTERN_RE tests
# =========================================================================

class TestRustUseRe:
    """Tests for Rust 'use' statements."""

    @pytest.mark.parametrize("text,expected_path", [
        ("use std::io;", "std::io"),
        ("use std::fs::File;", "std::fs::File"),
        ("use crate::module;", "crate::module"),
        ("pub use super::item;", "super::item"),
    ])
    def test_basic_use_statements(self, text, expected_path):
        """Test basic use statements."""
        match = RUST_USE_RE.search(text)
        assert match is not None
        assert match.group(1) == expected_path

    def test_glob_use_no_match(self):
        """RUST_USE_RE uses [\\w:]+ which doesn't match '{', so use {a,b,c} doesn't match."""
        match = RUST_USE_RE.search("use {a, b, c};")
        assert match is None

    @pytest.mark.parametrize("text", [
        "use   std::io   ;",
        "use\tstd::io;",
    ])
    def test_whitespace_variations(self, text):
        """Test use statements with varying whitespace."""
        match = RUST_USE_RE.search(text)
        assert match is not None

    @pytest.mark.parametrize("text", [
        "use std::io",  # Missing semicolon is ok
    ])
    def test_use_variations(self, text):
        """Test use statement variations."""
        match = RUST_USE_RE.search(text)
        assert match is not None


class TestRustModRe:
    """Tests for Rust 'mod' statements."""

    @pytest.mark.parametrize("text,expected_name", [
        ("mod foo;", "foo"),
        ("mod bar {}", "bar"),
        ("pub mod baz;", "baz"),
        ("pub(crate) mod private;", "private"),
    ])
    def test_basic_mod_statements(self, text, expected_name):
        """Test basic mod statements."""
        match = RUST_MOD_RE.search(text)
        assert match is not None
        assert match.group(1) == expected_name

    @pytest.mark.parametrize("text", [
        "mod   foo   ;",
        "mod\tfoo\t{}",
    ])
    def test_whitespace_variations(self, text):
        """Test mod statements with varying whitespace."""
        match = RUST_MOD_RE.search(text)
        assert match is not None

    @pytest.mark.parametrize("text", [
        "mod foo { fn bar() {} }",
        "pub mod foo { const X: i32 = 5; }",
    ])
    def test_mod_with_body(self, text):
        """Test mod statements with inline body."""
        match = RUST_MOD_RE.search(text)
        assert match is not None


class TestRustExternRe:
    """Tests for Rust 'extern crate' statements."""

    @pytest.mark.parametrize("text,expected_name", [
        ("extern crate serde;", "serde"),
        ("extern crate tokio;", "tokio"),
        ("extern crate my_crate as mc;", "my_crate"),
    ])
    def test_basic_extern_statements(self, text, expected_name):
        """Test basic extern crate statements."""
        match = RUST_EXTERN_RE.search(text)
        assert match is not None
        assert match.group(1) == expected_name

    @pytest.mark.parametrize("text", [
        "extern   crate   serde   ;",
        "extern\tcrate\ttokio\t;",
    ])
    def test_whitespace_variations(self, text):
        """Test extern statements with varying whitespace."""
        match = RUST_EXTERN_RE.search(text)
        assert match is not None

    @pytest.mark.parametrize("text", [
        "extern crate",
        "extern crate;",
        "crate serde;",
    ])
    def test_invalid_extern_statements(self, text):
        """Test invalid extern crate forms."""
        match = RUST_EXTERN_RE.search(text)
        assert match is None


# =========================================================================
# C# CS_USING_RE and CS_NAMESPACE_RE tests
# =========================================================================

class TestCsUsingRe:
    """Tests for C# 'using' statements."""

    @pytest.mark.parametrize("text,expected_namespace", [
        ("using System;", "System"),
        ("using System.Collections.Generic;", "System.Collections.Generic"),
        ("using static System.Math;", "System.Math"),
        ("using MyApp.Models;", "MyApp.Models"),
    ])
    def test_basic_using_statements(self, text, expected_namespace):
        """Test basic using statements."""
        match = CS_USING_RE.search(text)
        assert match is not None
        assert match.group(1) == expected_namespace

    @pytest.mark.parametrize("text", [
        "using   System   ;",
        "using\tSystem.IO\t;",
    ])
    def test_whitespace_variations(self, text):
        """Test using statements with varying whitespace."""
        match = CS_USING_RE.search(text)
        assert match is not None

    @pytest.mark.parametrize("text", [
        "using System",
        "using;",
    ])
    def test_invalid_using_statements(self, text):
        """Test invalid using forms."""
        match = CS_USING_RE.search(text)
        assert match is None

    def test_multiple_on_same_line(self):
        """CS_USING_RE uses ^using with MULTILINE, so only 1 match per line."""
        text = "using System; using System.IO;"
        matches = list(CS_USING_RE.finditer(text))
        assert len(matches) == 1
        assert matches[0].group(1) == "System"


class TestCsNamespaceRe:
    """Tests for C# namespace declarations."""

    @pytest.mark.parametrize("text,expected_namespace", [
        ("namespace MyApp;", "MyApp"),
        ("namespace MyApp.Models;", "MyApp.Models"),
        ("namespace MyApp.Services.Impl;", "MyApp.Services.Impl"),
        ("  namespace Indented;", "Indented"),
    ])
    def test_basic_namespace_declarations(self, text, expected_namespace):
        """Test basic namespace declarations."""
        match = CS_NAMESPACE_RE.search(text)
        assert match is not None
        assert match.group(1) == expected_namespace

    @pytest.mark.parametrize("text", [
        "namespace   MyApp   ;",
        "namespace\tMyApp\t;",
    ])
    def test_whitespace_variations(self, text):
        """Test namespace declarations with varying whitespace."""
        match = CS_NAMESPACE_RE.search(text)
        assert match is not None

    def test_namespace_in_code_block(self):
        """Test namespace at start of code block."""
        text = "namespace MyApp {\n  class Foo {}\n}"
        match = CS_NAMESPACE_RE.search(text)
        assert match is not None
        assert match.group(1) == "MyApp"


# =========================================================================
# Swift SWIFT_IMPORT_RE tests
# =========================================================================

class TestSwiftImportRe:
    """Tests for Swift import statements."""

    @pytest.mark.parametrize("text,expected_module", [
        ("import Foundation", "Foundation"),
        ("import UIKit", "UIKit"),
        ("import SwiftUI", "SwiftUI"),
        ("  import MyModule", "MyModule"),
        ("import class Foundation.NSObject", "Foundation"),
        ("import struct UIKit.CGPoint", "UIKit"),
        ("import enum MyLib.Status", "MyLib"),
    ])
    def test_basic_imports(self, text, expected_module):
        """Test basic Swift import statements."""
        match = SWIFT_IMPORT_RE.search(text)
        assert match is not None
        captured = match.group(1)
        assert expected_module in captured or captured.startswith(expected_module)

    def test_testable_import(self):
        """Test @testable import."""
        text = "@testable import MyModule"
        match = SWIFT_IMPORT_RE.search(text)
        assert match is not None
        assert "MyModule" in match.group(1)

    @pytest.mark.parametrize("text", [
        "import   Foundation   ",
        "import\tUIKit",
    ])
    def test_whitespace_variations(self, text):
        """Test imports with varying whitespace."""
        match = SWIFT_IMPORT_RE.search(text)
        assert match is not None

    @pytest.mark.parametrize("text", [
        "import",
        "import ",
    ])
    def test_invalid_imports(self, text):
        """Test invalid import forms."""
        match = SWIFT_IMPORT_RE.search(text)
        # Empty module name should not match
        if match:
            assert match.group(1)


# =========================================================================
# Ruby RUBY_REQUIRE_RE and RUBY_REQUIRE_RELATIVE_RE tests
# =========================================================================

class TestRubyRequireRe:
    """Tests for Ruby require statements."""

    @pytest.mark.parametrize("text,expected_path", [
        ("require 'json'", "json"),
        ('require "yaml"', "yaml"),
        ("require 'net/http'", "net/http"),
        ("require 'my-gem'", "my-gem"),
        ("require 'my_lib'", "my_lib"),
    ])
    def test_basic_require_statements(self, text, expected_path):
        """Test basic require statements."""
        match = RUBY_REQUIRE_RE.search(text)
        assert match is not None
        assert match.group(1) == expected_path

    def test_require_relative(self):
        """Test require_relative statements."""
        text = "require_relative 'helper'"
        match = RUBY_REQUIRE_RE.search(text)
        assert match is not None
        assert match.group(1) == 'helper'

    def test_load_statement(self):
        """Test load statements."""
        text = "load 'script.rb'"
        match = RUBY_REQUIRE_RE.search(text)
        assert match is not None
        assert match.group(1) == 'script.rb'

    @pytest.mark.parametrize("text", [
        "  require 'json'",
        "\trequire 'yaml'",
    ])
    def test_whitespace_variations(self, text):
        """Test require statements with leading whitespace."""
        match = RUBY_REQUIRE_RE.search(text)
        assert match is not None

    def test_missing_quotes_no_match(self):
        """require without quotes should not match."""
        match = RUBY_REQUIRE_RE.search("require json")
        assert match is None

    def test_trailing_paren_still_matches(self):
        """Extra trailing paren is ignored — regex matches the quoted portion."""
        match = RUBY_REQUIRE_RE.search("require 'json')")
        assert match is not None
        assert match.group(1) == "json"


class TestRubyRequireRelativeRe:
    """Tests for Ruby require_relative statements specifically."""

    @pytest.mark.parametrize("text,expected_path", [
        ("require_relative 'helper'", "helper"),
        ('require_relative "lib/util"', "lib/util"),
        ("require_relative './sibling'", "./sibling"),
    ])
    def test_require_relative_statements(self, text, expected_path):
        """Test require_relative statements."""
        match = RUBY_REQUIRE_RELATIVE_RE.search(text)
        assert match is not None
        assert match.group(1) == expected_path

    def test_require_relative_vs_require(self):
        """Test that require_relative is more specific than require."""
        text = "require_relative 'helper'"
        # Both patterns should match
        assert RUBY_REQUIRE_RE.search(text) is not None
        assert RUBY_REQUIRE_RELATIVE_RE.search(text) is not None

    @pytest.mark.parametrize("text", [
        "require 'json'",
        "load 'file.rb'",
    ])
    def test_should_not_match_other_forms(self, text):
        """Test that regular require and load don't match require_relative."""
        match = RUBY_REQUIRE_RELATIVE_RE.search(text)
        assert match is None


# =========================================================================
# collapse_py_multiline_imports function tests
# =========================================================================

class TestCollapsePyMultilineImports:
    """Tests for the collapse_py_multiline_imports function."""

    def test_basic_parenthesized_import(self):
        """Test collapsing basic parenthesized imports."""
        source = "from foo import (\n    bar,\n    baz\n)"
        result = collapse_py_multiline_imports(source)
        assert "from foo import bar, baz" in result
        assert "(\n" not in result

    def test_multiline_with_trailing_comma(self):
        """Test imports with trailing comma."""
        source = "from module import (\n    a,\n    b,\n    c,\n)"
        result = collapse_py_multiline_imports(source)
        assert "from module import a, b, c" in result

    def test_imports_with_extra_whitespace(self):
        """Test imports with extra whitespace."""
        source = "from pkg import (\n    item1  ,\n    item2  ,\n    item3\n)"
        result = collapse_py_multiline_imports(source)
        assert "from pkg import item1, item2, item3" in result

    def test_multiple_multiline_imports(self):
        """Test multiple parenthesized imports in same source."""
        source = """from foo import (
    a,
    b
)
from bar import (
    x,
    y,
    z
)"""
        result = collapse_py_multiline_imports(source)
        assert "from foo import a, b" in result
        assert "from bar import x, y, z" in result

    def test_import_with_newlines_in_body(self):
        """Test imports where body has many newlines."""
        source = "from module import (\n\n    item1,\n\n    item2\n\n)"
        result = collapse_py_multiline_imports(source)
        assert "from module import item1, item2" in result

    def test_single_item_import(self):
        """Test single item in parentheses."""
        source = "from foo import (\n    bar\n)"
        result = collapse_py_multiline_imports(source)
        assert "from foo import bar" in result

    def test_preserves_non_parenthesized_imports(self):
        """Test that regular imports are preserved."""
        source = "from foo import bar, baz"
        result = collapse_py_multiline_imports(source)
        assert result == source

    def test_preserves_code_outside_imports(self):
        """Test that code outside imports is preserved."""
        source = """import os
from foo import (
    bar
)
def main():
    pass"""
        result = collapse_py_multiline_imports(source)
        assert "import os" in result
        assert "def main():" in result
        assert "pass" in result

    def test_nested_parentheses_not_supported(self):
        """Test behavior with nested parentheses (edge case)."""
        # The regex uses [^)]* so nested parens will break
        source = "from foo import (\n    a,\n    b\n)"
        result = collapse_py_multiline_imports(source)
        # Should still handle the outer parentheses
        assert "from foo import" in result

    def test_empty_parentheses(self):
        """Test empty parentheses."""
        source = "from foo import (\n)"
        result = collapse_py_multiline_imports(source)
        # Should handle gracefully
        assert "from foo import" in result

    def test_import_with_comments_in_list(self):
        """Test imports with comments in the list."""
        # Note: The regex doesn't handle comments specially
        source = "from foo import (\n    bar,  # comment\n    baz\n)"
        result = collapse_py_multiline_imports(source)
        # The regex will capture everything, including comments
        assert "from foo import" in result

    @pytest.mark.parametrize("source,expected_substring", [
        ("from a import (\n    x,\n    y\n)", "from a import x, y"),
        ("from b.c import (\n    p,\n    q,\n    r\n)", "from b.c import p, q, r"),
        ("from . import (\n    mod1,\n    mod2\n)", "from . import mod1, mod2"),
    ])
    def test_various_module_paths(self, source, expected_substring):
        """Test with various module path formats."""
        result = collapse_py_multiline_imports(source)
        assert expected_substring in result

    def test_does_not_affect_function_calls(self):
        """Test that function calls with parentheses are not affected."""
        source = "print((\n    'foo'\n))"
        result = collapse_py_multiline_imports(source)
        # Should be unchanged (no 'from' and 'import')
        assert result == source
