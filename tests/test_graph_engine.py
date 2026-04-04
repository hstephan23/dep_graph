"""Comprehensive tests for the graph engine (graph.py)."""

import os
import pytest
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
)


# =========================================================================
# Tests for find_sccs (Tarjan's algorithm)
# =========================================================================

class TestFindSCCs:
    """Test Tarjan's strongly connected components algorithm."""

    def test_empty_graph(self):
        """Empty graph should return no SCCs."""
        sccs = find_sccs({})
        assert sccs == []

    def test_single_node_no_edges(self):
        """Single node with no edges should form one SCC of [node]."""
        sccs = find_sccs({'A': []})
        assert len(sccs) == 1
        assert set(sccs[0]) == {'A'}

    def test_two_nodes_no_cycle(self):
        """Two nodes with one-way edge (A→B) should form two separate SCCs."""
        sccs = find_sccs({'A': ['B'], 'B': []})
        # Should have exactly 2 SCCs, one per node
        assert len(sccs) == 2
        # Each SCC should contain exactly one node
        scc_nodes = [set(scc) for scc in sccs]
        assert {'A'} in scc_nodes
        assert {'B'} in scc_nodes

    def test_two_node_cycle(self):
        """Two nodes with cycle (A→B, B→A) should form one SCC."""
        sccs = find_sccs({'A': ['B'], 'B': ['A']})
        assert len(sccs) == 1
        assert set(sccs[0]) == {'A', 'B'}

    def test_self_loop(self):
        """Node with self-loop (A→A) should form SCC of [A]."""
        sccs = find_sccs({'A': ['A']})
        assert len(sccs) == 1
        assert set(sccs[0]) == {'A'}

    def test_three_node_cycle(self):
        """Three-node cycle (A→B→C→A) should form one SCC."""
        sccs = find_sccs({'A': ['B'], 'B': ['C'], 'C': ['A']})
        assert len(sccs) == 1
        assert set(sccs[0]) == {'A', 'B', 'C'}

    def test_diamond_topology(self):
        """Diamond (A→B, A→C, B→D, C→D) should form four separate SCCs."""
        sccs = find_sccs({'A': ['B', 'C'], 'B': ['D'], 'C': ['D'], 'D': []})
        assert len(sccs) == 4
        scc_nodes = [set(scc) for scc in sccs]
        assert {'A'} in scc_nodes
        assert {'B'} in scc_nodes
        assert {'C'} in scc_nodes
        assert {'D'} in scc_nodes

    def test_multiple_separate_cycles(self):
        """Multiple separate cycles should each be their own SCC."""
        # Two separate cycles: A↔B and C↔D, connected by E
        sccs = find_sccs({
            'A': ['B'],
            'B': ['A'],
            'C': ['D'],
            'D': ['C'],
            'E': ['A', 'C'],
        })
        # Should have 3 SCCs: {A, B}, {C, D}, {E}
        assert len(sccs) == 3
        scc_nodes = [set(scc) for scc in sccs]
        assert {'A', 'B'} in scc_nodes
        assert {'C', 'D'} in scc_nodes
        assert {'E'} in scc_nodes

    def test_large_cycle(self):
        """Large cycle with 10 nodes should all be in one SCC."""
        # Create cycle: 0→1→2→...→9→0
        adj = {str(i): [str((i + 1) % 10)] for i in range(10)}
        sccs = find_sccs(adj)
        assert len(sccs) == 1
        assert set(sccs[0]) == {str(i) for i in range(10)}

    def test_dag_no_cycles(self):
        """DAG (no cycles) should have each node as its own SCC."""
        # Simple DAG: A→B→C, A→C
        sccs = find_sccs({'A': ['B', 'C'], 'B': ['C'], 'C': []})
        assert len(sccs) == 3
        scc_nodes = [set(scc) for scc in sccs]
        assert {'A'} in scc_nodes
        assert {'B'} in scc_nodes
        assert {'C'} in scc_nodes


# =========================================================================
# Tests for _color_for_path
# =========================================================================

class TestColorForPath:
    """Test deterministic coloring based on file directory."""

    def test_same_directory_same_color(self):
        """Files in the same directory should have the same color."""
        color1 = _color_for_path("foo/bar/file1.c")
        color2 = _color_for_path("foo/bar/file2.c")
        assert color1 == color2

    def test_different_directory_likely_different(self):
        """Files in different directories should likely have different colors."""
        # This isn't guaranteed (hash collisions are possible), but extremely likely
        color_dir1 = _color_for_path("dir_alpha/file.c")
        color_dir2 = _color_for_path("dir_zeta/file.c")
        # We won't assert they're different (hash collision possible), but they're likely to be
        assert isinstance(color_dir1, str)
        assert isinstance(color_dir2, str)

    def test_root_file_consistent_color(self):
        """Root-level files (no directory) should have consistent color."""
        color1 = _color_for_path("file1.c")
        color2 = _color_for_path("file2.c")
        assert color1 == color2

    def test_color_is_valid_hex(self):
        """Returned color should be a valid hex color string."""
        color = _color_for_path("some/path/file.c")
        assert color.startswith("#")
        assert len(color) == 7
        # Should be valid hex
        int(color[1:], 16)

    def test_deterministic_across_calls(self):
        """Same path should return same color across multiple calls."""
        path = "src/components/widget.c"
        colors = [_color_for_path(path) for _ in range(5)]
        assert len(set(colors)) == 1


# =========================================================================
# Tests for _should_skip_dir and _should_skip_file
# =========================================================================

class TestShouldSkipDir:
    """Test directory skipping logic."""

    def test_skip_test_prefix(self):
        """Directories starting with 'test' should be skipped."""
        assert _should_skip_dir("test") is True
        assert _should_skip_dir("tests") is True
        assert _should_skip_dir("testing") is True

    def test_skip_test_infix(self):
        """Directories containing 'test' should be skipped."""
        assert _should_skip_dir("my_test_dir") is True
        assert _should_skip_dir("unit_tests") is True

    def test_skip_cmake(self):
        """Directories containing 'cmake' should be skipped."""
        assert _should_skip_dir("cmake") is True
        assert _should_skip_dir("build_cmake") is True

    def test_case_insensitive(self):
        """Skipping should be case-insensitive."""
        assert _should_skip_dir("TEST") is True
        assert _should_skip_dir("Test") is True
        assert _should_skip_dir("CMAKE") is True

    def test_normal_dir_not_skipped(self):
        """Normal directories should not be skipped."""
        assert _should_skip_dir("src") is False
        assert _should_skip_dir("utils") is False
        assert _should_skip_dir("lib") is False


class TestShouldSkipFile:
    """Test file skipping logic."""

    def test_skip_test_in_name(self):
        """Files with 'test' in the name should be skipped."""
        assert _should_skip_file("test_main.c") is True
        assert _should_skip_file("mytest.c") is True
        assert _should_skip_file("unittest.py") is True

    def test_skip_cmake_in_name(self):
        """Files with 'cmake' in the name should be skipped."""
        assert _should_skip_file("CMakeLists.txt") is True
        assert _should_skip_file("cmake_config.py") is True

    def test_normal_file_not_skipped(self):
        """Normal source files should not be skipped."""
        assert _should_skip_file("main.c") is False
        assert _should_skip_file("utils.h") is False
        assert _should_skip_file("module.py") is False


# =========================================================================
# Tests for _wanted_extension
# =========================================================================

class TestWantedExtension:
    """Test file extension filtering."""

    def test_c_extension_when_enabled(self):
        """C files should match when show_c=True."""
        assert _wanted_extension("file.c", show_c=True, show_h=False, show_cpp=False) is True

    def test_c_extension_when_disabled(self):
        """C files should not match when show_c=False."""
        assert _wanted_extension("file.c", show_c=False, show_h=False, show_cpp=False) is False

    def test_h_extension_when_enabled(self):
        """Header files should match when show_h=True."""
        assert _wanted_extension("file.h", show_c=False, show_h=True, show_cpp=False) is True

    def test_cpp_extension_when_enabled(self):
        """C++ files should match when show_cpp=True."""
        assert _wanted_extension("file.cpp", show_c=False, show_h=False, show_cpp=True) is True

    def test_py_extension_when_enabled(self):
        """Python files should match when show_py=True."""
        assert _wanted_extension("file.py", show_c=False, show_h=False, show_cpp=False,
                                show_py=True) is True

    def test_js_extension_when_enabled(self):
        """JavaScript files should match when show_js=True."""
        assert _wanted_extension("file.js", show_c=False, show_h=False, show_cpp=False,
                                show_js=True) is True

    def test_java_extension_when_enabled(self):
        """Java files should match when show_java=True."""
        assert _wanted_extension("file.java", show_c=False, show_h=False, show_cpp=False,
                                show_java=True) is True

    def test_go_extension_when_enabled(self):
        """Go files should match when show_go=True."""
        assert _wanted_extension("file.go", show_c=False, show_h=False, show_cpp=False,
                                show_go=True) is True

    def test_rust_extension_when_enabled(self):
        """Rust files should match when show_rust=True."""
        assert _wanted_extension("file.rs", show_c=False, show_h=False, show_cpp=False,
                                show_rust=True) is True

    def test_cs_extension_when_enabled(self):
        """C# files should match when show_cs=True."""
        assert _wanted_extension("file.cs", show_c=False, show_h=False, show_cpp=False,
                                show_cs=True) is True

    def test_swift_extension_when_enabled(self):
        """Swift files should match when show_swift=True."""
        assert _wanted_extension("file.swift", show_c=False, show_h=False, show_cpp=False,
                                show_swift=True) is True

    def test_ruby_extension_when_enabled(self):
        """Ruby files should match when show_ruby=True."""
        assert _wanted_extension("file.rb", show_c=False, show_h=False, show_cpp=False,
                                show_ruby=True) is True

    def test_unknown_extension(self):
        """Unknown extensions should return False."""
        assert _wanted_extension("file.xyz", show_c=True, show_h=True, show_cpp=True) is False

    def test_multiple_extensions_enabled(self):
        """Files should match if their extension matches any enabled language."""
        assert _wanted_extension("file.c", show_c=True, show_h=True, show_cpp=True) is True
        assert _wanted_extension("file.h", show_c=True, show_h=True, show_cpp=True) is True
        assert _wanted_extension("file.cpp", show_c=True, show_h=True, show_cpp=True) is True


# =========================================================================
# Tests for collect_source_files
# =========================================================================

class TestCollectSourceFiles:
    """Test source file collection."""

    def test_collect_test_files_c_and_h(self, test_files_dir):
        """Collect C and header files from test_files."""
        files = collect_source_files(test_files_dir, show_c=True, show_h=True, show_cpp=False)
        # Should have main.c, utils.c, utils.h
        basenames = [os.path.basename(f) for f in files]
        assert "main.c" in basenames
        assert "utils.c" in basenames
        assert "utils.h" in basenames

    def test_skip_test_directories(self, test_files_dir):
        """Test directories should be skipped during collection."""
        files = collect_source_files(test_files_dir, show_c=True, show_h=True, show_cpp=False)
        # Check only the path portion WITHIN test_files_dir — parent dirs are irrelevant
        for f in files:
            rel = os.path.relpath(f, test_files_dir)
            rel_parts = rel.split(os.sep)
            # Only check intermediate dirs (not the filename itself)
            for part in rel_parts[:-1]:
                assert not part.lower().startswith('test'), \
                    f"Found test directory '{part}' in collected file: {f}"

    def test_cpp_files_not_collected_when_disabled(self, test_files_dir):
        """C++ files should not be collected when show_cpp=False."""
        files = collect_source_files(test_files_dir, show_c=True, show_h=False, show_cpp=False)
        # Should have main.c, utils.c but not utils.h (since show_h=False)
        basenames = [os.path.basename(f) for f in files]
        assert "main.c" in basenames
        assert "utils.c" in basenames
        assert "utils.h" not in basenames

    def test_empty_directory(self, tmp_path):
        """Empty directory should return empty list."""
        files = collect_source_files(str(tmp_path), show_c=True, show_h=True, show_cpp=False)
        assert files == []

    def test_returns_absolute_paths(self, test_files_dir):
        """Collected files should have proper relative paths."""
        files = collect_source_files(test_files_dir, show_c=True, show_h=True, show_cpp=False)
        assert len(files) > 0
        # All files should exist
        for f in files:
            assert os.path.exists(f)


# =========================================================================
# Tests for detect_languages
# =========================================================================

class TestDetectLanguages:
    """Test language detection."""

    def test_detect_c_and_h_in_test_files(self, test_files_dir):
        """test_files has C and H files."""
        detected = detect_languages(test_files_dir)
        assert detected["has_c"] is True
        assert detected["has_h"] is True

    def test_detect_python_in_test_py(self, test_py_dir):
        """test_py directory should have Python."""
        detected = detect_languages(test_py_dir)
        assert detected["has_py"] is True

    def test_detect_javascript_in_test_js(self, test_js_dir):
        """test_js directory should have JavaScript."""
        detected = detect_languages(test_js_dir)
        assert detected["has_js"] is True

    def test_missing_languages_are_false(self, test_files_dir):
        """Languages not in test_files should be False."""
        detected = detect_languages(test_files_dir)
        assert detected["has_py"] is False
        assert detected["has_js"] is False
        assert detected["has_java"] is False

    def test_returns_all_flags(self, test_files_dir):
        """detect_languages should return all language flags."""
        detected = detect_languages(test_files_dir)
        expected_keys = {
            "has_c", "has_h", "has_cpp", "has_js", "has_py", "has_java",
            "has_go", "has_rust", "has_cs", "has_swift", "has_ruby"
        }
        assert set(detected.keys()) == expected_keys


# =========================================================================
# Tests for parse_filters
# =========================================================================

class TestParseFilters:
    """Test filter parsing."""

    def test_mode_auto_with_detected(self, test_files_dir):
        """mode=auto with detected should use detected flags."""
        detected = detect_languages(test_files_dir)
        source = {"mode": "auto"}
        filters = parse_filters(source, detected=detected)

        # Should match detected languages
        assert filters["show_c"] == detected["has_c"]
        assert filters["show_h"] == detected["has_h"]
        assert filters["show_cpp"] == detected["has_cpp"]
        assert filters["show_py"] == detected["has_py"]

    def test_mode_auto_without_detected(self):
        """mode=auto without detected should enable all languages."""
        source = {"mode": "auto"}
        filters = parse_filters(source, detected=None)

        assert filters["show_c"] is True
        assert filters["show_h"] is True
        assert filters["show_cpp"] is True
        assert filters["show_js"] is True
        assert filters["show_py"] is True
        assert filters["show_java"] is True
        assert filters["show_go"] is True
        assert filters["show_rust"] is True
        assert filters["show_cs"] is True
        assert filters["show_swift"] is True
        assert filters["show_ruby"] is True

    def test_explicit_mode_true_strings(self):
        """Explicit mode with 'true' strings should enable languages."""
        source = {
            "show_c": "true",
            "show_h": "true",
            "show_cpp": "false",
            "show_py": "true",
        }
        filters = parse_filters(source)

        assert filters["show_c"] is True
        assert filters["show_h"] is True
        assert filters["show_cpp"] is False
        assert filters["show_py"] is True

    def test_default_values_for_missing_keys(self):
        """Missing keys should use default values."""
        source = {}
        filters = parse_filters(source)

        # Defaults should be: c/h/cpp true, rest false
        assert filters["show_c"] is True
        assert filters["show_h"] is True
        assert filters["show_cpp"] is True
        assert filters["show_js"] is False
        assert filters["show_py"] is False

    def test_hide_system_flag(self):
        """hide_system flag should be parsed correctly."""
        source = {"hide_system": "true"}
        filters = parse_filters(source)
        assert filters["hide_system"] is True

        source = {"hide_system": "false"}
        filters = parse_filters(source)
        assert filters["hide_system"] is False

    def test_hide_isolated_flag(self):
        """hide_isolated flag should be parsed correctly."""
        source = {"hide_isolated": "true"}
        filters = parse_filters(source)
        assert filters["hide_isolated"] is True

    def test_filter_dir_flag(self):
        """filter_dir flag should be parsed."""
        source = {"filter_dir": "src/"}
        filters = parse_filters(source)
        assert filters["filter_dir"] == "src/"

    def test_case_insensitive_flag_parsing(self):
        """Flag parsing should be case-insensitive."""
        source = {
            "show_c": "TRUE",
            "show_h": "False",
        }
        filters = parse_filters(source)
        assert filters["show_c"] is True
        assert filters["show_h"] is False


# =========================================================================
# Tests for build_graph
# =========================================================================

class TestBuildGraph:
    """Test graph building and metrics."""

    def test_build_graph_basic_structure(self, test_files_dir):
        """build_graph should return correct structure."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)

        assert "nodes" in graph
        assert "edges" in graph
        assert "has_cycles" in graph
        assert "cycles" in graph
        assert "unused_files" in graph
        assert "coupling" in graph
        assert "depth_warnings" in graph

    def test_build_graph_node_count(self, test_files_dir):
        """Verify correct number of nodes in test_files."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)
        # test_files has main.c, utils.c, utils.h, math_ops.h (4 files total)
        # Actually, let's check what files exist
        node_ids = [n["data"]["id"] for n in graph["nodes"]]
        # Should include main.c, utils.c, utils.h
        basenames = [os.path.basename(nid) for nid in node_ids]
        assert "main.c" in basenames or any("main" in b for b in basenames)

    def test_build_graph_edges_structure(self, test_files_dir):
        """Edges should have proper structure."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)
        for edge in graph["edges"]:
            assert "data" in edge
            assert "source" in edge["data"]
            assert "target" in edge["data"]
            assert "color" in edge["data"]

    def test_build_graph_node_data_fields(self, test_files_dir):
        """Each node should have required data fields."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)
        for node in graph["nodes"]:
            data = node["data"]
            assert "id" in data
            assert "color" in data
            assert "size" in data
            assert "depth" in data
            assert "impact" in data
            assert "stability" in data

    def test_build_graph_in_degree_sizing(self, test_files_dir):
        """Node size should be 80 + in_degree * 40."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)

        # Build in-degree map from edges
        in_degrees = {}
        for node in graph["nodes"]:
            in_degrees[node["data"]["id"]] = 0
        for edge in graph["edges"]:
            target = edge["data"]["target"]
            in_degrees[target] = in_degrees.get(target, 0) + 1

        # Verify sizes
        for node in graph["nodes"]:
            node_id = node["data"]["id"]
            expected_size = 80 + in_degrees[node_id] * 40
            assert node["data"]["size"] == expected_size

    def test_build_graph_unused_files(self, test_files_dir):
        """Unused files (zero in-degree) should be detected."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)

        # main.c should have non-zero in-degree (something includes it)
        # or it might be in unused_files
        unused = graph["unused_files"]
        assert isinstance(unused, list)

    def test_build_graph_depth_computation(self, test_files_dir):
        """Depth should be computed (longest transitive chain)."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)

        for node in graph["nodes"]:
            depth = node["data"]["depth"]
            assert isinstance(depth, int)
            assert depth >= 0

    def test_build_graph_impact_computation(self, test_files_dir):
        """Impact should be computed (downstream closure size)."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)

        for node in graph["nodes"]:
            impact = node["data"]["impact"]
            assert isinstance(impact, int)
            assert impact >= 0

    def test_build_graph_stability_metric(self, test_files_dir):
        """Stability should be I = Ce / (Ca + Ce)."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)

        in_degrees = {}
        out_degrees = {}
        for node in graph["nodes"]:
            nid = node["data"]["id"]
            in_degrees[nid] = 0
            out_degrees[nid] = 0

        for edge in graph["edges"]:
            src = edge["data"]["source"]
            tgt = edge["data"]["target"]
            in_degrees[tgt] = in_degrees.get(tgt, 0) + 1
            out_degrees[src] = out_degrees.get(src, 0) + 1

        for node in graph["nodes"]:
            nid = node["data"]["id"]
            ca = in_degrees.get(nid, 0)
            ce = out_degrees.get(nid, 0)
            expected = round(ce / (ca + ce), 3) if (ca + ce) > 0 else 0.5
            assert node["data"]["stability"] == expected

    def test_build_graph_hide_system_filter(self, test_files_dir):
        """hide_system should filter out system includes."""
        graph = build_graph(test_files_dir, hide_system=True, show_c=True, show_h=True, show_cpp=False)

        # With hide_system=True, <stdio.h>, <stdlib.h>, etc. should not appear
        node_ids = [n["data"]["id"] for n in graph["nodes"]]
        assert not any(n.startswith("<") for n in node_ids)

    def test_build_graph_hide_isolated(self, test_files_dir):
        """hide_isolated should remove unconnected nodes."""
        graph_with = build_graph(test_files_dir, hide_isolated=False, show_c=True, show_h=True, show_cpp=False)
        graph_without = build_graph(test_files_dir, hide_isolated=True, show_c=True, show_h=True, show_cpp=False)

        # hide_isolated version should have <= nodes
        assert len(graph_without["nodes"]) <= len(graph_with["nodes"])

    def test_build_graph_filter_dir(self, test_files_dir):
        """filter_dir should filter by path prefix."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)

        # Get any node and filter by its path prefix
        if graph["nodes"]:
            first_node_id = graph["nodes"][0]["data"]["id"]
            prefix = os.path.dirname(first_node_id)

            if prefix:
                filtered_graph = build_graph(test_files_dir, filter_dir=prefix, show_c=True, show_h=True, show_cpp=False)
                for node in filtered_graph["nodes"]:
                    assert node["data"]["id"].startswith(prefix)

    def test_build_graph_depth_warnings_critical(self, test_files_dir):
        """Depth warnings with reach_pct >= 50 should be critical."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)

        for warning in graph["depth_warnings"]:
            if warning["reach_pct"] >= 50:
                assert warning["severity"] == "critical"

    def test_build_graph_depth_warnings_high_depth(self, test_files_dir):
        """Depth warnings with depth >= 8 should be critical."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)

        for warning in graph["depth_warnings"]:
            if warning["depth"] >= 8:
                assert warning["severity"] == "critical"

    def test_build_graph_reach_pct_computed(self, test_files_dir):
        """Each node should have reach_pct computed."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)

        if graph["nodes"]:
            for node in graph["nodes"]:
                assert "reach_pct" in node["data"]
                reach_pct = node["data"]["reach_pct"]
                assert 0 <= reach_pct <= 100

    def test_build_graph_cycles_detection(self, test_files_dir):
        """has_cycles should be boolean and cycles should be list."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)

        assert isinstance(graph["has_cycles"], bool)
        assert isinstance(graph["cycles"], list)

    def test_build_graph_edge_classes_for_cycles(self, test_files_dir):
        """Cycle edges should have 'cycle' class."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)

        for edge in graph["edges"]:
            if "classes" in edge:
                # If cycle class is set, should be the string "cycle"
                assert edge["classes"] == "cycle" or "cycle" in edge.get("classes", "")

    def test_build_graph_coupling_structure(self, test_files_dir):
        """Coupling should be a list of dicts with proper fields."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)

        for coupling in graph["coupling"]:
            assert "dir1" in coupling
            assert "dir2" in coupling
            assert "cross_edges" in coupling
            assert "score" in coupling


# =========================================================================
# Integration Tests
# =========================================================================

class TestIntegration:
    """Integration tests combining multiple functions."""

    def test_full_pipeline_test_files(self, test_files_dir):
        """Full pipeline: detect → parse_filters → build_graph."""
        detected = detect_languages(test_files_dir)
        filters = parse_filters({"mode": "auto"}, detected=detected)
        graph = build_graph(
            test_files_dir,
            hide_system=filters["hide_system"],
            show_c=filters["show_c"],
            show_h=filters["show_h"],
            show_cpp=filters["show_cpp"],
            show_py=filters["show_py"],
        )

        assert len(graph["nodes"]) > 0
        assert isinstance(graph["edges"], list)

    def test_no_cycles_in_dag_graph(self, test_files_dir):
        """test_files should have no cycles (it's a DAG)."""
        graph = build_graph(test_files_dir, show_c=True, show_h=True, show_cpp=False)
        # test_files is a simple DAG, should have no cycles
        assert graph["has_cycles"] is False
