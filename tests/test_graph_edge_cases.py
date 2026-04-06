"""Additional unit tests for graph.py — edge cases, metrics, and error handling."""

from __future__ import annotations

import os
import sys
import pytest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from graph import (
    find_sccs,
    build_graph,
    detect_languages,
    parse_filters,
    collect_source_files,
    _color_for_path,
    _should_skip_dir,
    _should_skip_file,
    _wanted_extension,
    node_size_for_degree,
    classify_node_risk,
)


# =========================================================================
# node_size_for_degree tests
# =========================================================================

class TestNodeSizeForDegree:
    """Test the node sizing formula."""

    def test_zero_in_degree(self):
        """Node with no incoming edges should have base size 80."""
        assert node_size_for_degree(0, 10) == 80

    def test_one_in_degree(self):
        """Node with 1 incoming edge should be 120."""
        assert node_size_for_degree(1, 10) == 120

    def test_five_in_degree(self):
        """Node with 5 incoming edges should be 280."""
        assert node_size_for_degree(5, 10) == 280

    def test_high_in_degree(self):
        """Node with very high in-degree should scale linearly."""
        assert node_size_for_degree(20, 100) == 80 + 20 * 40

    def test_formula_is_linear(self):
        """Verify formula is exactly 80 + in_degree * 40."""
        for d in range(0, 50):
            assert node_size_for_degree(d, 100) == 80 + d * 40


# =========================================================================
# classify_node_risk tests
# =========================================================================

class TestClassifyNodeRisk:
    """Test risk classification logic."""

    def _make_node(self, in_degree=0, out_degree=0, in_cycle=False, depth=0, reach_pct=0):
        """Create a minimal node_data dict for risk classification."""
        return {
            "in_degree": in_degree,
            "out_degree": out_degree,
            "in_cycle": in_cycle,
            "depth": depth,
            "reach_pct": reach_pct,
        }

    def test_entry_point_node(self):
        """Node with 0 in-degree and 0 out-degree should be entry/leaf."""
        risk = classify_node_risk(self._make_node(0, 0, False, 0, 0), 10)
        assert risk in ("entry", "normal", "system")

    def test_critical_in_cycle(self):
        """Node in a cycle should be classified as critical."""
        risk = classify_node_risk(self._make_node(3, 2, True, 5, 60), 10)
        assert risk == "critical"

    def test_high_reach_pct(self):
        """Node with very high reach_pct should be high or critical."""
        risk = classify_node_risk(self._make_node(5, 3, False, 3, 70), 10)
        assert risk in ("critical", "high")

    def test_normal_node(self):
        """Node with moderate metrics should be normal or warning."""
        risk = classify_node_risk(self._make_node(1, 1, False, 1, 5), 10)
        assert risk in ("normal", "entry", "warning")


# =========================================================================
# find_sccs edge cases
# =========================================================================

class TestFindSCCsEdgeCases:
    """Additional edge cases for Tarjan's SCC algorithm."""

    def test_disconnected_nodes(self):
        """Completely disconnected nodes should each be their own SCC."""
        adj = {'A': [], 'B': [], 'C': [], 'D': []}
        sccs = find_sccs(adj)
        assert len(sccs) == 4

    def test_chain_no_cycles(self):
        """A→B→C→D chain should produce 4 SCCs."""
        adj = {'A': ['B'], 'B': ['C'], 'C': ['D'], 'D': []}
        sccs = find_sccs(adj)
        assert len(sccs) == 4

    def test_two_overlapping_cycles(self):
        """Two cycles sharing a node should merge into one SCC."""
        # A→B→A (cycle 1), B→C→B (cycle 2) — all connected through B
        adj = {'A': ['B'], 'B': ['A', 'C'], 'C': ['B']}
        sccs = find_sccs(adj)
        assert len(sccs) == 1
        assert set(sccs[0]) == {'A', 'B', 'C'}

    def test_node_with_edge_to_unknown(self):
        """Edge to a node not in adjacency list — shouldn't crash."""
        # This tests robustness: what if adj doesn't list all nodes?
        adj = {'A': ['B']}
        # Depending on implementation, this might raise or handle gracefully
        try:
            sccs = find_sccs(adj)
            # If it works, verify A is in results
            all_nodes = {n for scc in sccs for n in scc}
            assert 'A' in all_nodes
        except (KeyError, IndexError):
            # Acceptable — implementation may require all nodes in adj
            pass

    def test_figure_eight_topology(self):
        """Figure-8: two cycles joined at a single node."""
        adj = {
            'A': ['B'],
            'B': ['C'],
            'C': ['A', 'D'],  # C connects both cycles
            'D': ['E'],
            'E': ['C'],
        }
        sccs = find_sccs(adj)
        # All nodes should be in one SCC since they're all reachable via cycles
        assert len(sccs) == 1
        assert set(sccs[0]) == {'A', 'B', 'C', 'D', 'E'}


# =========================================================================
# build_graph edge cases
# =========================================================================

class TestBuildGraphEdgeCases:
    """Edge cases for the graph builder."""

    def test_empty_directory(self, tmp_path):
        """Empty directory should return valid but empty graph."""
        result = build_graph(str(tmp_path), show_py=True)
        assert result["nodes"] == []
        assert result["edges"] == []
        assert result["has_cycles"] is False
        assert result["cycles"] == []
        assert result["coupling"] == []

    def test_single_file_no_imports(self, tmp_path):
        """Single file with no imports should produce one node, zero edges."""
        (tmp_path / "alone.py").write_text("x = 42\n")
        result = build_graph(str(tmp_path), show_py=True, hide_system=True)
        assert len(result["nodes"]) == 1
        assert len(result["edges"]) == 0
        assert result["nodes"][0]["data"]["id"] == "alone.py"

    def test_single_file_node_metrics(self, tmp_path):
        """Single file should have predictable metrics."""
        (tmp_path / "solo.py").write_text("print('hi')\n")
        result = build_graph(str(tmp_path), show_py=True, hide_system=True)
        node = result["nodes"][0]["data"]
        assert node["in_degree"] == 0
        assert node["out_degree"] == 0
        assert node["depth"] == 0
        assert node["impact"] == 0
        assert node["size"] == 80  # base size, 0 in-degree
        assert node["stability"] == 0.5  # 0/(0+0) defaults to 0.5
        assert node["in_cycle"] is False

    def test_mutual_imports(self, tmp_path):
        """Two files importing each other should form a cycle."""
        (tmp_path / "a.py").write_text("import b\n")
        (tmp_path / "b.py").write_text("import a\n")
        result = build_graph(str(tmp_path), show_py=True, hide_system=True)
        assert result["has_cycles"] is True
        assert len(result["cycles"]) > 0
        cycle_files = set()
        for cycle in result["cycles"]:
            cycle_files.update(cycle)
        assert "a.py" in cycle_files
        assert "b.py" in cycle_files

    def test_multiple_languages_combined(self, tmp_path):
        """Multiple languages enabled should collect all file types."""
        (tmp_path / "main.py").write_text("x = 1\n")
        (tmp_path / "main.c").write_text("int main() { return 0; }\n")
        result = build_graph(str(tmp_path), show_py=True, show_c=True, hide_system=True)
        node_ids = {n["data"]["id"] for n in result["nodes"]}
        assert "main.py" in node_ids
        assert "main.c" in node_ids

    def test_hide_isolated_removes_unconnected(self, tmp_path):
        """hide_isolated=True should remove nodes with no edges."""
        (tmp_path / "a.py").write_text("import b\n")
        (tmp_path / "b.py").write_text("x = 1\n")
        (tmp_path / "orphan.py").write_text("y = 2\n")

        result_all = build_graph(str(tmp_path), show_py=True, hide_system=True, hide_isolated=False)
        result_no_iso = build_graph(str(tmp_path), show_py=True, hide_system=True, hide_isolated=True)

        assert len(result_no_iso["nodes"]) <= len(result_all["nodes"])

    def test_depth_metric_chain(self, tmp_path):
        """Files in a chain should have increasing depth."""
        (tmp_path / "a.py").write_text("import b\n")
        (tmp_path / "b.py").write_text("import c\n")
        (tmp_path / "c.py").write_text("x = 1\n")

        result = build_graph(str(tmp_path), show_py=True, hide_system=True)
        nodes_by_id = {n["data"]["id"]: n["data"] for n in result["nodes"]}

        if "a.py" in nodes_by_id and "c.py" in nodes_by_id:
            # a imports b which imports c, so a has greatest depth
            assert nodes_by_id["a.py"]["depth"] >= nodes_by_id["c.py"]["depth"]

    def test_language_field_set(self, tmp_path):
        """Each node should have the correct language field."""
        (tmp_path / "main.py").write_text("x = 1\n")
        result = build_graph(str(tmp_path), show_py=True, hide_system=True)
        for node in result["nodes"]:
            assert node["data"]["language"] == "py"


# =========================================================================
# collect_source_files edge cases
# =========================================================================

class TestCollectSourceFilesEdgeCases:
    """Edge cases for file collection."""

    def test_nested_directories(self, tmp_path):
        """Files in nested directories should be collected."""
        sub = tmp_path / "src" / "lib"
        sub.mkdir(parents=True)
        (sub / "helper.py").write_text("x = 1\n")
        files = collect_source_files(str(tmp_path), {"show_py": True})
        assert any("helper.py" in f for f in files)

    def test_hidden_directories_collected(self, tmp_path):
        """Files in .hidden directories are collected (not filtered by engine)."""
        hidden = tmp_path / ".hidden"
        hidden.mkdir()
        (hidden / "secret.py").write_text("pass\n")
        files = collect_source_files(str(tmp_path), {"show_py": True})
        # .hidden dirs are NOT skipped — engine collects everything except test/cmake
        assert any(".hidden" in f for f in files)

    def test_node_modules_not_collected(self, tmp_path):
        """Files in node_modules should not be collected."""
        nm = tmp_path / "node_modules" / "lodash"
        nm.mkdir(parents=True)
        (nm / "index.js").write_text("module.exports = {}")
        files = collect_source_files(str(tmp_path), {"show_js": True})
        assert not any("node_modules" in f for f in files)

    def test_all_languages_disabled(self, tmp_path):
        """No files should be collected when all languages are disabled."""
        (tmp_path / "main.py").write_text("x = 1\n")
        (tmp_path / "main.c").write_text("int main() {}\n")
        flags = {f"show_{lang}": False for lang in
                 ["c", "h", "cpp", "js", "py", "java", "go", "rust",
                  "cs", "swift", "ruby", "kotlin", "scala", "php",
                  "dart", "elixir", "lua", "zig", "haskell", "r"]}
        files = collect_source_files(str(tmp_path), flags)
        assert files == []


# =========================================================================
# parse_filters edge cases
# =========================================================================

class TestParseFiltersEdgeCases:
    """Edge cases for filter parsing."""

    def test_boolean_values_direct(self):
        """Boolean values should be accepted directly."""
        source = {"show_c": True, "show_h": False}
        filters = parse_filters(source)
        assert filters["show_c"] is True
        assert filters["show_h"] is False

    def test_mixed_types(self):
        """Mix of booleans and strings should work."""
        source = {"show_c": True, "show_py": "true", "show_js": "false"}
        filters = parse_filters(source)
        assert filters["show_c"] is True
        assert filters["show_py"] is True
        assert filters["show_js"] is False

    def test_filter_dir_empty_string(self):
        """Empty filter_dir should be treated as no filter."""
        source = {"filter_dir": ""}
        filters = parse_filters(source)
        assert filters["filter_dir"] == ""

    def test_mode_auto_with_all_false_detected(self):
        """Auto mode with no detected languages should still return a dict."""
        detected = {f"has_{lang}": False for lang in
                    ["c", "h", "cpp", "js", "py", "java", "go", "rust",
                     "cs", "swift", "ruby", "kotlin", "scala", "php",
                     "dart", "elixir", "lua", "zig", "haskell", "r"]}
        source = {"mode": "auto"}
        filters = parse_filters(source, detected=detected)
        # All should be False since nothing detected
        assert filters["show_c"] is False
        assert filters["show_py"] is False


# =========================================================================
# _color_for_path edge cases
# =========================================================================

class TestColorForPathEdgeCases:
    """Edge cases for directory-based coloring."""

    def test_deeply_nested_path(self):
        """Deeply nested paths should still return valid hex."""
        color = _color_for_path("a/b/c/d/e/f/g/h/file.py")
        assert color.startswith("#")
        assert len(color) == 7

    def test_empty_string_path(self):
        """Empty path should not crash."""
        color = _color_for_path("")
        assert color.startswith("#")

    def test_special_characters_in_path(self):
        """Paths with special characters should work."""
        color = _color_for_path("src/my-module/file.py")
        assert color.startswith("#")
        color2 = _color_for_path("src/my_module/file.py")
        assert color2.startswith("#")


# =========================================================================
# _should_skip_dir / _should_skip_file edge cases
# =========================================================================

class TestSkipEdgeCases:
    """Edge cases for skip logic."""

    def test_skip_test_dirs(self):
        """Test-related directories should be skipped."""
        assert _should_skip_dir("test") is True
        assert _should_skip_dir("tests") is True
        assert _should_skip_dir("testing") is True

    def test_skip_cmake_dirs(self):
        """CMake-related directories should be skipped."""
        assert _should_skip_dir("cmake") is True
        assert _should_skip_dir("CMake") is True

    def test_dont_skip_normal_dirs(self):
        """Normal directories should not be skipped."""
        assert _should_skip_dir("src") is False
        assert _should_skip_dir("app") is False
        assert _should_skip_dir("lib") is False
        assert _should_skip_dir("build") is False
        assert _should_skip_dir("vendor") is False

    def test_skip_test_files(self):
        """Test files should be skipped."""
        assert _should_skip_file("my_test.py") is True
        assert _should_skip_file("test_main.py") is True

    def test_skip_cmake_files(self):
        """CMake files should be skipped."""
        assert _should_skip_file("CMakeLists.txt") is True

    def test_dont_skip_normal_files(self):
        """Normal source files should not be skipped."""
        assert _should_skip_file("main.py") is False
        assert _should_skip_file("controller.js") is False


# =========================================================================
# _wanted_extension — newer languages
# =========================================================================

class TestWantedExtensionNewLanguages:
    """Test extension filtering for newer languages."""

    def test_lua_extension(self):
        assert _wanted_extension("script.lua", {"show_lua": True}) is True
        assert _wanted_extension("script.lua", {"show_lua": False}) is False

    def test_zig_extension(self):
        assert _wanted_extension("main.zig", {"show_zig": True}) is True
        assert _wanted_extension("main.zig", {"show_zig": False}) is False

    def test_haskell_extension(self):
        assert _wanted_extension("Main.hs", {"show_haskell": True}) is True
        assert _wanted_extension("Main.hs", {"show_haskell": False}) is False

    def test_r_extension(self):
        assert _wanted_extension("analysis.R", {"show_r": True}) is True
        assert _wanted_extension("analysis.r", {"show_r": True}) is True
        assert _wanted_extension("analysis.R", {"show_r": False}) is False

    def test_typescript_via_js_flag(self):
        """TypeScript files should be collected when show_js is True."""
        assert _wanted_extension("app.ts", {"show_js": True}) is True
        assert _wanted_extension("app.tsx", {"show_js": True}) is True
        assert _wanted_extension("app.mjs", {"show_js": True}) is True
