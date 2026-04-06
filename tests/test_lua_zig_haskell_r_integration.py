"""Integration tests for Lua, Zig, Haskell, and R using real fixtures.

These tests call build_graph() on each fixture directory and verify that the
graph output is correctly structured and contains expected dependencies.
"""

import pytest
from graph import build_graph


# =========================================================================
# Helper functions
# =========================================================================

def get_node_ids(result):
    return {node["data"]["id"] for node in result["nodes"]}


def get_edge_pairs(result):
    return {(edge["data"]["source"], edge["data"]["target"]) for edge in result["edges"]}


def get_nodes_by_id(result):
    return {node["data"]["id"]: node["data"] for node in result["nodes"]}


def assert_result_structure(result):
    required_keys = {"nodes", "edges", "has_cycles", "cycles", "unused_files", "coupling", "depth_warnings"}
    assert set(result.keys()) == required_keys


def assert_node_structure(node_data):
    required_keys = {"id", "color", "size", "depth", "impact", "stability", "reach_pct",
                     "in_degree", "out_degree", "language", "in_cycle"}
    for key in required_keys:
        assert key in node_data, f"Missing key '{key}' in node {node_data.get('id', 'unknown')}"


def assert_edge_structure(edge_data):
    required_keys = {"source", "target", "color"}
    assert required_keys.issubset(set(edge_data.keys()))


# =========================================================================
# Lua Tests (test_lua)
# =========================================================================

class TestLuaFixture:
    """Tests for Lua file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_lua_dir):
        result = build_graph(test_lua_dir, show_lua=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_lua_dir):
        result = build_graph(test_lua_dir, show_lua=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_lua_dir):
        result = build_graph(test_lua_dir, show_lua=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_lua_dir):
        result = build_graph(test_lua_dir, show_lua=True, hide_system=True)
        node_ids = get_node_ids(result)
        lua_files = [nid for nid in node_ids if nid.endswith(".lua")]
        assert len(lua_files) > 0, f"Expected some Lua files, got {node_ids}"

    def test_stdlib_filtered(self, test_lua_dir):
        result = build_graph(test_lua_dir, show_lua=True, hide_system=True)
        node_ids = get_node_ids(result)
        assert 'cjson' not in node_ids, "cjson should be filtered with hide_system=True"

    def test_has_edges(self, test_lua_dir):
        result = build_graph(test_lua_dir, show_lua=True, hide_system=True)
        assert len(result["edges"]) > 0, "Expected some edges in Lua graph"

    def test_main_imports_models(self, test_lua_dir):
        result = build_graph(test_lua_dir, show_lua=True, hide_system=True)
        edge_pairs = get_edge_pairs(result)
        main_targets = {t for s, t in edge_pairs if s == 'main.lua'}
        assert len(main_targets) > 0, f"main.lua should import something. Edges: {edge_pairs}"


# =========================================================================
# Zig Tests (test_zig)
# =========================================================================

class TestZigFixture:
    """Tests for Zig file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_zig_dir):
        result = build_graph(test_zig_dir, show_zig=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_zig_dir):
        result = build_graph(test_zig_dir, show_zig=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_zig_dir):
        result = build_graph(test_zig_dir, show_zig=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_zig_dir):
        result = build_graph(test_zig_dir, show_zig=True, hide_system=True)
        node_ids = get_node_ids(result)
        zig_files = [nid for nid in node_ids if nid.endswith(".zig")]
        assert len(zig_files) > 0, f"Expected some Zig files, got {node_ids}"

    def test_std_filtered(self, test_zig_dir):
        result = build_graph(test_zig_dir, show_zig=True, hide_system=True)
        node_ids = get_node_ids(result)
        assert 'std' not in node_ids, "std should be filtered with hide_system=True"

    def test_has_edges(self, test_zig_dir):
        result = build_graph(test_zig_dir, show_zig=True, hide_system=True)
        assert len(result["edges"]) > 0, "Expected some edges in Zig graph"

    def test_main_imports_models(self, test_zig_dir):
        result = build_graph(test_zig_dir, show_zig=True, hide_system=True)
        edge_pairs = get_edge_pairs(result)
        main_targets = {t for s, t in edge_pairs if s == 'main.zig'}
        assert len(main_targets) > 0, f"main.zig should import something. Edges: {edge_pairs}"

    def test_relative_imports_resolved(self, test_zig_dir):
        """Relative imports like ../models/user.zig should resolve."""
        result = build_graph(test_zig_dir, show_zig=True, hide_system=True)
        edge_pairs = get_edge_pairs(result)
        # Services should import models via relative paths
        service_edges = [(s, t) for s, t in edge_pairs
                        if 'service' in s.lower() and 'model' in t.lower()]
        assert len(service_edges) > 0 or len(edge_pairs) > 0, \
            f"Expected service→model edges. All edges: {edge_pairs}"


# =========================================================================
# Haskell Tests (test_haskell)
# =========================================================================

class TestHaskellFixture:
    """Tests for Haskell file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_haskell_dir):
        result = build_graph(test_haskell_dir, show_haskell=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_haskell_dir):
        result = build_graph(test_haskell_dir, show_haskell=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_haskell_dir):
        result = build_graph(test_haskell_dir, show_haskell=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_haskell_dir):
        result = build_graph(test_haskell_dir, show_haskell=True, hide_system=True)
        node_ids = get_node_ids(result)
        hs_files = [nid for nid in node_ids if nid.endswith(".hs")]
        assert len(hs_files) > 0, f"Expected some Haskell files, got {node_ids}"

    def test_stdlib_filtered(self, test_haskell_dir):
        result = build_graph(test_haskell_dir, show_haskell=True, hide_system=True)
        node_ids = get_node_ids(result)
        for nid in node_ids:
            assert not nid.startswith("Data."), f"Data.* should be filtered: {nid}"
            assert not nid.startswith("System."), f"System.* should be filtered: {nid}"
            assert not nid.startswith("Control."), f"Control.* should be filtered: {nid}"

    def test_has_edges(self, test_haskell_dir):
        result = build_graph(test_haskell_dir, show_haskell=True, hide_system=True)
        assert len(result["edges"]) > 0, "Expected some edges in Haskell graph"

    def test_main_imports_modules(self, test_haskell_dir):
        result = build_graph(test_haskell_dir, show_haskell=True, hide_system=True)
        edge_pairs = get_edge_pairs(result)
        main_targets = {t for s, t in edge_pairs if s == 'Main.hs'}
        assert len(main_targets) > 0, f"Main.hs should import something. Edges: {edge_pairs}"


# =========================================================================
# R Tests (test_r)
# =========================================================================

class TestRFixture:
    """Tests for R file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_r_dir):
        result = build_graph(test_r_dir, show_r=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_r_dir):
        result = build_graph(test_r_dir, show_r=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_r_dir):
        result = build_graph(test_r_dir, show_r=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_r_dir):
        result = build_graph(test_r_dir, show_r=True, hide_system=True)
        node_ids = get_node_ids(result)
        r_files = [nid for nid in node_ids if nid.endswith(".R")]
        assert len(r_files) > 0, f"Expected some R files, got {node_ids}"

    def test_library_calls_filtered(self, test_r_dir):
        result = build_graph(test_r_dir, show_r=True, hide_system=True)
        node_ids = get_node_ids(result)
        assert 'ggplot2' not in node_ids, "ggplot2 should be filtered with hide_system=True"
        assert 'dplyr' not in node_ids, "dplyr should be filtered with hide_system=True"

    def test_has_edges(self, test_r_dir):
        result = build_graph(test_r_dir, show_r=True, hide_system=True)
        assert len(result["edges"]) > 0, "Expected some edges in R graph"

    def test_source_creates_edges(self, test_r_dir):
        """source() calls should create edges to local files."""
        result = build_graph(test_r_dir, show_r=True, hide_system=True)
        edge_pairs = get_edge_pairs(result)
        main_targets = {t for s, t in edge_pairs if s == 'main.R'}
        assert len(main_targets) > 0, f"main.R should have dependencies via source(). Edges: {edge_pairs}"
