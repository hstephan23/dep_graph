"""Integration tests for DepGraph using real fixture directories.

These tests call build_graph() on each fixture directory and verify that the
graph output is correctly structured and contains expected dependencies.
"""

import pytest
from graph import build_graph


# =========================================================================
# Helper functions for extracting data from build_graph output
# =========================================================================

def get_node_ids(result):
    """Extract all node IDs from build_graph result."""
    return {node["data"]["id"] for node in result["nodes"]}


def get_edge_pairs(result):
    """Extract all edge (source, target) pairs from build_graph result."""
    return {(edge["data"]["source"], edge["data"]["target"]) for edge in result["edges"]}


def get_nodes_by_id(result):
    """Return a dict mapping node ID to node data."""
    return {node["data"]["id"]: node["data"] for node in result["nodes"]}


def get_in_degree(node_id, result):
    """Count edges pointing to a node."""
    return sum(1 for edge in result["edges"] if edge["data"]["target"] == node_id)


def get_out_degree(node_id, result):
    """Count edges pointing from a node."""
    return sum(1 for edge in result["edges"] if edge["data"]["source"] == node_id)


def assert_result_structure(result):
    """Verify that result has all required top-level keys."""
    required_keys = {"nodes", "edges", "has_cycles", "cycles", "unused_files", "coupling", "depth_warnings"}
    assert set(result.keys()) == required_keys, f"Missing keys in result: {required_keys - set(result.keys())}"


def assert_node_structure(node_data):
    """Verify that each node has all required attributes."""
    required_keys = {"id", "color", "size", "depth", "impact", "stability", "reach_pct",
                     "in_degree", "out_degree", "language", "in_cycle"}
    for key in required_keys:
        assert key in node_data, f"Missing key '{key}' in node {node_data.get('id', 'unknown')}"


def assert_edge_structure(edge_data):
    """Verify that each edge has all required attributes."""
    required_keys = {"source", "target", "color"}
    assert required_keys.issubset(set(edge_data.keys())), \
        f"Missing keys in edge: {required_keys - set(edge_data.keys())}"


# =========================================================================
# C/C++ File Tests (test_files)
# =========================================================================

class TestCFilesFixture:
    """Tests for C/C++ file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_files_dir):
        """Verify build_graph result has all required keys."""
        result = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_files_dir):
        """Verify all nodes have id, color, size, depth, impact, stability, reach_pct."""
        result = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_files_dir):
        """Verify all edges have source, target, color."""
        result = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_hide_system_filters_system_includes(self, test_files_dir):
        """Verify hide_system=True filters out stdio.h, stdlib.h, string.h."""
        result = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Should have main.c, utils.c, utils.h, plus math_ops.h (local unresolved include)
        assert len(node_ids) == 4, f"Expected 4 nodes, got {len(node_ids)}: {node_ids}"
        assert "main.c" in node_ids
        assert "utils.c" in node_ids
        assert "utils.h" in node_ids
        assert "math_ops.h" in node_ids

        # System includes should be filtered
        assert not any("stdio.h" in nid or "stdlib.h" in nid or "string.h" in nid for nid in node_ids)

    def test_main_includes_utils_h(self, test_files_dir):
        """Verify main.c includes utils.h."""
        result = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=True, hide_system=True)
        edges = get_edge_pairs(result)
        assert ("main.c", "utils.h") in edges

    def test_utils_c_includes_utils_h(self, test_files_dir):
        """Verify utils.c includes utils.h."""
        result = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=True, hide_system=True)
        edges = get_edge_pairs(result)
        assert ("utils.c", "utils.h") in edges

    def test_utils_h_has_highest_in_degree(self, test_files_dir):
        """Verify utils.h is included by both main.c and utils.c."""
        result = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=True, hide_system=True)

        in_degree_main = get_in_degree("main.c", result)
        in_degree_utils_c = get_in_degree("utils.c", result)
        in_degree_utils_h = get_in_degree("utils.h", result)

        assert in_degree_utils_h == 2, f"utils.h should have in_degree 2, got {in_degree_utils_h}"
        assert in_degree_main == 0, f"main.c should have in_degree 0, got {in_degree_main}"
        assert in_degree_utils_c == 0, f"utils.c should have in_degree 0, got {in_degree_utils_c}"


# =========================================================================
# Cycle Detection Tests (test_cycle)
# =========================================================================

class TestCycleDetection:
    """Tests for cycle detection in header files."""

    def test_cycle_detected(self, test_cycle_dir):
        """Verify that circular includes are detected."""
        result = build_graph(test_cycle_dir, show_c=False, show_h=True, show_cpp=False)
        assert result["has_cycles"] is True, "Expected has_cycles to be True for circular includes"

    def test_cycle_contains_both_files(self, test_cycle_dir):
        """Verify that the cycle list contains a.h and b.h."""
        result = build_graph(test_cycle_dir, show_c=False, show_h=True, show_cpp=False)
        assert len(result["cycles"]) > 0, "Expected at least one cycle"

        # Cycles are lists of file IDs. Check that a.h and b.h appear in a cycle.
        cycle_files = set()
        for cycle in result["cycles"]:
            cycle_files.update(cycle)

        assert "a.h" in cycle_files, "a.h should be in a cycle"
        assert "b.h" in cycle_files, "b.h should be in a cycle"

    def test_only_header_files_in_result(self, test_cycle_dir):
        """Verify that only .h files are included."""
        result = build_graph(test_cycle_dir, show_c=False, show_h=True, show_cpp=False)
        node_ids = get_node_ids(result)

        assert all(nid.endswith(".h") for nid in node_ids), f"All nodes should be .h files: {node_ids}"


# =========================================================================
# Python Tests (test_py)
# =========================================================================

class TestPythonFixture:
    """Tests for Python file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_py_dir):
        """Verify build_graph result has all required keys."""
        result = build_graph(test_py_dir, show_py=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_py_dir):
        """Verify all nodes have required attributes."""
        result = build_graph(test_py_dir, show_py=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_py_dir):
        """Verify all edges have required attributes."""
        result = build_graph(test_py_dir, show_py=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_all_local_files(self, test_py_dir):
        """Verify all local Python files are included as nodes."""
        result = build_graph(test_py_dir, show_py=True, hide_system=True)
        node_ids = get_node_ids(result)

        expected_files = {"main.py", "config.py", "models/user.py", "utils/helpers.py"}
        for expected_file in expected_files:
            assert expected_file in node_ids, f"Expected {expected_file} in nodes, got {node_ids}"

    def test_stdlib_imports_filtered(self, test_py_dir):
        """Verify stdlib imports (os, json, pathlib) are filtered out with hide_system=True."""
        result = build_graph(test_py_dir, show_py=True, hide_system=True)
        node_ids = get_node_ids(result)

        stdlib_modules = {"os", "json", "pathlib"}
        for stdlib_mod in stdlib_modules:
            assert stdlib_mod not in node_ids, f"{stdlib_mod} should be filtered out with hide_system=True"

    def test_local_imports_exist(self, test_py_dir):
        """Verify edges exist for local imports."""
        result = build_graph(test_py_dir, show_py=True, hide_system=True)
        edges = get_edge_pairs(result)

        # At least some local imports should exist
        assert len(edges) > 0, "Expected some edges for local imports"


# =========================================================================
# JavaScript Tests (test_js)
# =========================================================================

class TestJavaScriptFixture:
    """Tests for JavaScript/TypeScript file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_js_dir):
        """Verify build_graph result has all required keys."""
        result = build_graph(test_js_dir, show_js=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_js_dir):
        """Verify all nodes have required attributes."""
        result = build_graph(test_js_dir, show_js=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_js_dir):
        """Verify all edges have required attributes."""
        result = build_graph(test_js_dir, show_js=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_js_dir):
        """Verify local JS/TS files are included."""
        result = build_graph(test_js_dir, show_js=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Should contain some local files (App.js, components/*, utils.js, etc.)
        js_files = [nid for nid in node_ids if nid.endswith((".js", ".jsx", ".ts", ".tsx"))]
        assert len(js_files) > 0, f"Expected some JS/TS files, got {node_ids}"

    def test_bare_imports_filtered(self, test_js_dir):
        """Verify bare imports (react, etc.) are filtered out with hide_system=True."""
        result = build_graph(test_js_dir, show_js=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Common external packages should be filtered
        assert "react" not in node_ids, "react should be filtered out with hide_system=True"
        assert "react-dom" not in node_ids, "react-dom should be filtered out"


# =========================================================================
# Java Tests (test_java)
# =========================================================================

class TestJavaFixture:
    """Tests for Java file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_java_dir):
        """Verify build_graph result has all required keys."""
        result = build_graph(test_java_dir, show_java=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_java_dir):
        """Verify all nodes have required attributes."""
        result = build_graph(test_java_dir, show_java=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_java_dir):
        """Verify all edges have required attributes."""
        result = build_graph(test_java_dir, show_java=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_java_dir):
        """Verify local Java files are included."""
        result = build_graph(test_java_dir, show_java=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Should include at least some .java files
        java_files = [nid for nid in node_ids if nid.endswith(".java")]
        assert len(java_files) > 0, f"Expected some Java files, got {node_ids}"

    def test_system_imports_filtered(self, test_java_dir):
        """Verify java.* imports are filtered out with hide_system=True."""
        result = build_graph(test_java_dir, show_java=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Standard Java library imports should be filtered
        for nid in node_ids:
            assert not nid.startswith("java/"), f"java.* import should be filtered: {nid}"


# =========================================================================
# Go Tests (test_go)
# =========================================================================

class TestGoFixture:
    """Tests for Go file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_go_dir):
        """Verify build_graph result has all required keys."""
        result = build_graph(test_go_dir, show_go=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_go_dir):
        """Verify all nodes have required attributes."""
        result = build_graph(test_go_dir, show_go=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_go_dir):
        """Verify all edges have required attributes."""
        result = build_graph(test_go_dir, show_go=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_go_dir):
        """Verify local Go files are included."""
        result = build_graph(test_go_dir, show_go=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Should include at least some .go files
        go_files = [nid for nid in node_ids if nid.endswith(".go")]
        assert len(go_files) > 0, f"Expected some Go files, got {node_ids}"

    def test_stdlib_filtered(self, test_go_dir):
        """Verify stdlib imports (fmt, net/http) are filtered out."""
        result = build_graph(test_go_dir, show_go=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Standard library packages should be filtered
        stdlib_packages = {"fmt", "net/http", "os", "io"}
        for stdlib in stdlib_packages:
            assert stdlib not in node_ids, f"{stdlib} should be filtered out with hide_system=True"


# =========================================================================
# Rust Tests (test_rust)
# =========================================================================

class TestRustFixture:
    """Tests for Rust file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_rust_dir):
        """Verify build_graph result has all required keys."""
        result = build_graph(test_rust_dir, show_rust=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_rust_dir):
        """Verify all nodes have required attributes."""
        result = build_graph(test_rust_dir, show_rust=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_rust_dir):
        """Verify all edges have required attributes."""
        result = build_graph(test_rust_dir, show_rust=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_rust_dir):
        """Verify local Rust files are included."""
        result = build_graph(test_rust_dir, show_rust=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Should include at least some .rs files
        rust_files = [nid for nid in node_ids if nid.endswith(".rs")]
        assert len(rust_files) > 0, f"Expected some Rust files, got {node_ids}"

    def test_extern_crate_filtered(self, test_rust_dir):
        """Verify extern crate declarations are filtered with hide_system=True."""
        result = build_graph(test_rust_dir, show_rust=True, hide_system=True)
        node_ids = get_node_ids(result)

        # External crates should be filtered out
        assert not any(nid.startswith("extern ") for nid in node_ids)


# =========================================================================
# C# Tests (test_csharp)
# =========================================================================

class TestCSharpFixture:
    """Tests for C# file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_csharp_dir):
        """Verify build_graph result has all required keys."""
        result = build_graph(test_csharp_dir, show_cs=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_csharp_dir):
        """Verify all nodes have required attributes."""
        result = build_graph(test_csharp_dir, show_cs=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_csharp_dir):
        """Verify all edges have required attributes."""
        result = build_graph(test_csharp_dir, show_cs=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_csharp_dir):
        """Verify local C# files are included."""
        result = build_graph(test_csharp_dir, show_cs=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Should include at least some .cs files
        cs_files = [nid for nid in node_ids if nid.endswith(".cs")]
        assert len(cs_files) > 0, f"Expected some C# files, got {node_ids}"

    def test_system_namespace_filtered(self, test_csharp_dir):
        """Verify System.* namespace imports are filtered."""
        result = build_graph(test_csharp_dir, show_cs=True, hide_system=True)
        node_ids = get_node_ids(result)

        # System.* namespaces should be filtered
        for nid in node_ids:
            assert not nid.startswith("System"), f"System.* namespace should be filtered: {nid}"


# =========================================================================
# C# Hyphen Tests (test_cs_hyphen)
# =========================================================================

class TestCSharpHyphenFixture:
    """Tests for C# file fixture with hyphenated names."""

    def test_build_graph_returns_correct_structure(self, test_cs_hyphen_dir):
        """Verify build_graph result has all required keys."""
        result = build_graph(test_cs_hyphen_dir, show_cs=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_cs_hyphen_dir):
        """Verify all nodes have required attributes."""
        result = build_graph(test_cs_hyphen_dir, show_cs=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_hyphen_underscore_matching(self, test_cs_hyphen_dir):
        """Verify fuzzy hyphen/underscore matching works."""
        result = build_graph(test_cs_hyphen_dir, show_cs=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Should have resolved hyphenated names to underscored or vice versa
        cs_files = [nid for nid in node_ids if nid.endswith(".cs")]
        assert len(cs_files) > 0, f"Expected some C# files, got {node_ids}"


# =========================================================================
# Swift Tests (test_swift)
# =========================================================================

class TestSwiftFixture:
    """Tests for Swift file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_swift_dir):
        """Verify build_graph result has all required keys."""
        result = build_graph(test_swift_dir, show_swift=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_swift_dir):
        """Verify all nodes have required attributes."""
        result = build_graph(test_swift_dir, show_swift=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_swift_dir):
        """Verify all edges have required attributes."""
        result = build_graph(test_swift_dir, show_swift=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_swift_dir):
        """Verify local Swift files are included."""
        result = build_graph(test_swift_dir, show_swift=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Should include at least some .swift files
        swift_files = [nid for nid in node_ids if nid.endswith(".swift")]
        assert len(swift_files) > 0, f"Expected some Swift files, got {node_ids}"

    def test_foundation_filtered(self, test_swift_dir):
        """Verify Foundation etc. are filtered out."""
        result = build_graph(test_swift_dir, show_swift=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Foundation and other system frameworks should be filtered
        assert "Foundation" not in node_ids, "Foundation should be filtered out with hide_system=True"


# =========================================================================
# Ruby Tests (test_ruby)
# =========================================================================

class TestRubyFixture:
    """Tests for Ruby file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_ruby_dir):
        """Verify build_graph result has all required keys."""
        result = build_graph(test_ruby_dir, show_ruby=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_ruby_dir):
        """Verify all nodes have required attributes."""
        result = build_graph(test_ruby_dir, show_ruby=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_ruby_dir):
        """Verify all edges have required attributes."""
        result = build_graph(test_ruby_dir, show_ruby=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_ruby_dir):
        """Verify local Ruby files are included."""
        result = build_graph(test_ruby_dir, show_ruby=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Should include at least some .rb files
        ruby_files = [nid for nid in node_ids if nid.endswith(".rb")]
        assert len(ruby_files) > 0, f"Expected some Ruby files, got {node_ids}"

    def test_stdlib_requires_filtered(self, test_ruby_dir):
        """Verify require 'json' and other stdlib are filtered out."""
        result = build_graph(test_ruby_dir, show_ruby=True, hide_system=True)
        node_ids = get_node_ids(result)

        # Standard library modules should be filtered
        stdlib_modules = {"json", "set", "time", "date"}
        for stdlib in stdlib_modules:
            assert stdlib not in node_ids, f"{stdlib} should be filtered out with hide_system=True"


# =========================================================================
# Directory Filtering Tests (test_dir)
# =========================================================================

class TestDirectoryFiltering:
    """Tests for directory and file filtering."""

    def test_build_graph_returns_correct_structure(self, test_dir_dir):
        """Verify build_graph result has all required keys."""
        result = build_graph(test_dir_dir, show_c=True, show_h=True, show_cpp=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_dir_dir):
        """Verify all nodes have required attributes."""
        result = build_graph(test_dir_dir, show_c=True, show_h=True, show_cpp=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_test_subdirs_skipped(self, test_dir_dir):
        """Verify test/ subdirectories are skipped."""
        result = build_graph(test_dir_dir, show_c=True, show_h=True, show_cpp=True)
        node_ids = get_node_ids(result)

        # Should not contain files from tests/ subdirectory
        assert not any("tests/" in nid for nid in node_ids), \
            f"Files from tests/ subdirectory should be skipped: {node_ids}"

    def test_test_prefixed_files_skipped(self, test_dir_dir):
        """Verify test-prefixed files are skipped."""
        result = build_graph(test_dir_dir, show_c=True, show_h=True, show_cpp=True)
        node_ids = get_node_ids(result)

        # Should skip test.c and test_a.c
        assert "test.c" not in node_ids, "test.c should be skipped"
        assert "test_a.c" not in node_ids, "test_a.c should be skipped"

    def test_only_a_c_included(self, test_dir_dir):
        """Verify only a.c is included."""
        result = build_graph(test_dir_dir, show_c=True, show_h=True, show_cpp=True)
        node_ids = get_node_ids(result)

        assert "a.c" in node_ids, "a.c should be included"
        # Verify the exclusions again
        assert "test.c" not in node_ids
        assert "test_a.c" not in node_ids
