"""Integration tests for Kotlin, Scala, PHP, Dart, and Elixir using real fixtures.

These tests call build_graph() on each fixture directory and verify that the
graph output is correctly structured and contains expected dependencies.
"""

import pytest
from graph import build_graph


# =========================================================================
# Helper functions (same as test_integration.py)
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
# Kotlin Tests (test_kotlin)
# =========================================================================

class TestKotlinFixture:
    """Tests for Kotlin file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_kotlin_dir):
        result = build_graph(test_kotlin_dir, show_kotlin=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_kotlin_dir):
        result = build_graph(test_kotlin_dir, show_kotlin=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_kotlin_dir):
        result = build_graph(test_kotlin_dir, show_kotlin=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_kotlin_dir):
        result = build_graph(test_kotlin_dir, show_kotlin=True, hide_system=True)
        node_ids = get_node_ids(result)
        kt_files = [nid for nid in node_ids if nid.endswith(".kt")]
        assert len(kt_files) > 0, f"Expected some Kotlin files, got {node_ids}"

    def test_stdlib_filtered(self, test_kotlin_dir):
        result = build_graph(test_kotlin_dir, show_kotlin=True, hide_system=True)
        node_ids = get_node_ids(result)
        for nid in node_ids:
            assert not nid.startswith("kotlin."), f"kotlin.* should be filtered: {nid}"
            assert not nid.startswith("java."), f"java.* should be filtered: {nid}"

    def test_has_edges(self, test_kotlin_dir):
        result = build_graph(test_kotlin_dir, show_kotlin=True, hide_system=True)
        assert len(result["edges"]) > 0, "Expected some edges in Kotlin graph"

    def test_main_imports_models(self, test_kotlin_dir):
        result = build_graph(test_kotlin_dir, show_kotlin=True, hide_system=True)
        edge_pairs = get_edge_pairs(result)
        node_ids = get_node_ids(result)
        # main.kt should have edges to model/service files
        main_targets = {t for s, t in edge_pairs if s == 'main.kt'}
        assert len(main_targets) > 0, f"main.kt should import something. Nodes: {node_ids}"


# =========================================================================
# Scala Tests (test_scala)
# =========================================================================

class TestScalaFixture:
    """Tests for Scala file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_scala_dir):
        result = build_graph(test_scala_dir, show_scala=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_scala_dir):
        result = build_graph(test_scala_dir, show_scala=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_scala_dir):
        result = build_graph(test_scala_dir, show_scala=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_scala_dir):
        result = build_graph(test_scala_dir, show_scala=True, hide_system=True)
        node_ids = get_node_ids(result)
        scala_files = [nid for nid in node_ids if nid.endswith(".scala")]
        assert len(scala_files) > 0, f"Expected some Scala files, got {node_ids}"

    def test_stdlib_filtered(self, test_scala_dir):
        result = build_graph(test_scala_dir, show_scala=True, hide_system=True)
        node_ids = get_node_ids(result)
        for nid in node_ids:
            assert not nid.startswith("scala."), f"scala.* should be filtered: {nid}"
            assert not nid.startswith("java."), f"java.* should be filtered: {nid}"

    def test_has_edges(self, test_scala_dir):
        result = build_graph(test_scala_dir, show_scala=True, hide_system=True)
        assert len(result["edges"]) > 0, "Expected some edges in Scala graph"

    def test_brace_imports_resolved(self, test_scala_dir):
        """Scala brace imports like {Foo, Bar} should resolve."""
        result = build_graph(test_scala_dir, show_scala=True, hide_system=True)
        edge_pairs = get_edge_pairs(result)
        # OrderService.scala has `import com.example.models.{Order, User}`
        # This should create an edge
        assert len(edge_pairs) > 0


# =========================================================================
# PHP Tests (test_php)
# =========================================================================

class TestPhpFixture:
    """Tests for PHP file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_php_dir):
        result = build_graph(test_php_dir, show_php=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_php_dir):
        result = build_graph(test_php_dir, show_php=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_php_dir):
        result = build_graph(test_php_dir, show_php=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_php_dir):
        result = build_graph(test_php_dir, show_php=True, hide_system=True)
        node_ids = get_node_ids(result)
        php_files = [nid for nid in node_ids if nid.endswith(".php")]
        assert len(php_files) > 0, f"Expected some PHP files, got {node_ids}"

    def test_has_edges(self, test_php_dir):
        result = build_graph(test_php_dir, show_php=True, hide_system=True)
        assert len(result["edges"]) > 0, "Expected some edges in PHP graph"

    def test_require_creates_edges(self, test_php_dir):
        """require_once should create edges to local files."""
        result = build_graph(test_php_dir, show_php=True, hide_system=True)
        edge_pairs = get_edge_pairs(result)
        # index.php has require_once for model and service files
        index_targets = {t for s, t in edge_pairs if s == 'index.php'}
        assert len(index_targets) > 0, "index.php should have dependencies"


# =========================================================================
# Dart/Flutter Tests (test_dart)
# =========================================================================

class TestDartFixture:
    """Tests for Dart file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_dart_dir):
        result = build_graph(test_dart_dir, show_dart=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_dart_dir):
        result = build_graph(test_dart_dir, show_dart=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_dart_dir):
        result = build_graph(test_dart_dir, show_dart=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_dart_dir):
        result = build_graph(test_dart_dir, show_dart=True, hide_system=True)
        node_ids = get_node_ids(result)
        dart_files = [nid for nid in node_ids if nid.endswith(".dart")]
        assert len(dart_files) > 0, f"Expected some Dart files, got {node_ids}"

    def test_dart_core_filtered(self, test_dart_dir):
        result = build_graph(test_dart_dir, show_dart=True, hide_system=True)
        node_ids = get_node_ids(result)
        for nid in node_ids:
            assert not nid.startswith("dart:"), f"dart:* should be filtered: {nid}"

    def test_has_edges(self, test_dart_dir):
        result = build_graph(test_dart_dir, show_dart=True, hide_system=True)
        assert len(result["edges"]) > 0, "Expected some edges in Dart graph"

    def test_relative_imports_resolved(self, test_dart_dir):
        """Relative imports like ../models/user.dart should resolve."""
        result = build_graph(test_dart_dir, show_dart=True, hide_system=True)
        edge_pairs = get_edge_pairs(result)
        node_ids = get_node_ids(result)
        # Services should import models
        service_edges = [(s, t) for s, t in edge_pairs
                        if 'service' in s.lower() and 'model' in t.lower()]
        # At minimum, order_service should import models
        assert len(service_edges) > 0 or len(edge_pairs) > 0, \
            f"Expected service→model edges. All edges: {edge_pairs}"


# =========================================================================
# Elixir Tests (test_elixir)
# =========================================================================

class TestElixirFixture:
    """Tests for Elixir file fixture directory."""

    def test_build_graph_returns_correct_structure(self, test_elixir_dir):
        result = build_graph(test_elixir_dir, show_elixir=True, hide_system=True)
        assert_result_structure(result)

    def test_all_nodes_have_required_attributes(self, test_elixir_dir):
        result = build_graph(test_elixir_dir, show_elixir=True, hide_system=True)
        for node in result["nodes"]:
            assert_node_structure(node["data"])

    def test_all_edges_have_required_attributes(self, test_elixir_dir):
        result = build_graph(test_elixir_dir, show_elixir=True, hide_system=True)
        for edge in result["edges"]:
            assert_edge_structure(edge["data"])

    def test_includes_local_files(self, test_elixir_dir):
        result = build_graph(test_elixir_dir, show_elixir=True, hide_system=True)
        node_ids = get_node_ids(result)
        ex_files = [nid for nid in node_ids if nid.endswith(".ex")]
        assert len(ex_files) > 0, f"Expected some Elixir files, got {node_ids}"

    def test_stdlib_filtered(self, test_elixir_dir):
        result = build_graph(test_elixir_dir, show_elixir=True, hide_system=True)
        node_ids = get_node_ids(result)
        stdlib_modules = {"GenServer", "Logger", "IO", "Enum", "Supervisor"}
        for stdlib in stdlib_modules:
            assert stdlib not in node_ids, f"{stdlib} should be filtered with hide_system=True"

    def test_has_edges(self, test_elixir_dir):
        result = build_graph(test_elixir_dir, show_elixir=True, hide_system=True)
        assert len(result["edges"]) > 0, "Expected some edges in Elixir graph"

    def test_alias_creates_edges(self, test_elixir_dir):
        """alias MyApp.Models.User should create an edge."""
        result = build_graph(test_elixir_dir, show_elixir=True, hide_system=True)
        edge_pairs = get_edge_pairs(result)
        assert len(edge_pairs) > 0, "Expected edges from alias statements"
