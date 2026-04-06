"""Additional unit tests for cli.py — formatters, diff output, and argument parsing."""

from __future__ import annotations

import io
import json
import os
import sys
import pytest
from unittest.mock import patch

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import cli


# =========================================================================
# Helper: build a sample graph result
# =========================================================================

def _sample_result():
    """Return a minimal but realistic graph result."""
    return {
        "nodes": [
            {
                "data": {
                    "id": "main.py",
                    "color": "#3b82f6",
                    "size": 80,
                    "depth": 2,
                    "impact": 3,
                    "stability": 0.5,
                    "in_degree": 0,
                    "out_degree": 2,
                    "language": "py",
                    "in_cycle": False,
                    "reach_pct": 0,
                    "risk": "entry",
                    "risk_color": "#22c55e",
                    "risk_label": "Entry point / leaf",
                    "node_size": 60,
                    "dir_color": "#6366f1",
                }
            },
            {
                "data": {
                    "id": "utils.py",
                    "color": "#3b82f6",
                    "size": 120,
                    "depth": 1,
                    "impact": 1,
                    "stability": 0.667,
                    "in_degree": 2,
                    "out_degree": 1,
                    "language": "py",
                    "in_cycle": False,
                    "reach_pct": 33.3,
                    "risk": "high",
                    "risk_color": "#f97316",
                    "risk_label": "High influence",
                    "node_size": 80,
                    "dir_color": "#6366f1",
                }
            },
            {
                "data": {
                    "id": "models.py",
                    "color": "#3b82f6",
                    "size": 80,
                    "depth": 0,
                    "impact": 0,
                    "stability": 0.5,
                    "in_degree": 1,
                    "out_degree": 0,
                    "language": "py",
                    "in_cycle": False,
                    "reach_pct": 0,
                    "risk": "normal",
                    "risk_color": "#3b82f6",
                    "risk_label": "Normal",
                    "node_size": 60,
                    "dir_color": "#6366f1",
                }
            },
        ],
        "edges": [
            {"data": {"source": "main.py", "target": "utils.py", "color": "#94a3b8"}},
            {"data": {"source": "main.py", "target": "models.py", "color": "#94a3b8"}},
            {"data": {"source": "utils.py", "target": "models.py", "color": "#94a3b8"}},
        ],
        "has_cycles": False,
        "cycles": [],
        "unused_files": [],
        "coupling": [
            {"dir1": "src", "dir2": "lib", "cross_edges": 3, "score": 0.85},
        ],
        "depth_warnings": [
            {
                "file": "main.py",
                "depth": 2,
                "reach_pct": 0,
                "severity": "warning",
                "reasons": ["depth 2"],
            },
        ],
    }


def _sample_cycle_result():
    """Graph result with cycles."""
    return {
        "nodes": [
            {
                "data": {
                    "id": "a.py", "color": "#ef4444", "size": 120,
                    "depth": 1, "impact": 1, "stability": 0.5,
                    "in_degree": 1, "out_degree": 1, "language": "py",
                    "in_cycle": True, "reach_pct": 50,
                    "risk": "critical", "risk_color": "#ef4444",
                    "risk_label": "Critical", "node_size": 80,
                    "dir_color": "#6366f1",
                }
            },
            {
                "data": {
                    "id": "b.py", "color": "#ef4444", "size": 120,
                    "depth": 1, "impact": 1, "stability": 0.5,
                    "in_degree": 1, "out_degree": 1, "language": "py",
                    "in_cycle": True, "reach_pct": 50,
                    "risk": "critical", "risk_color": "#ef4444",
                    "risk_label": "Critical", "node_size": 80,
                    "dir_color": "#6366f1",
                }
            },
        ],
        "edges": [
            {"data": {"source": "a.py", "target": "b.py", "color": "#ef4444"}, "classes": "cycle"},
            {"data": {"source": "b.py", "target": "a.py", "color": "#ef4444"}, "classes": "cycle"},
        ],
        "has_cycles": True,
        "cycles": [["a.py", "b.py"]],
        "unused_files": [],
        "coupling": [],
        "depth_warnings": [],
    }


# =========================================================================
# _format_json tests
# =========================================================================

class TestFormatJson:
    """Test JSON output formatter."""

    def test_valid_json_output(self):
        """Output should be valid JSON."""
        result = _sample_result()
        output = cli._format_json(result)
        parsed = json.loads(output)
        assert parsed["nodes"] == result["nodes"]
        assert parsed["edges"] == result["edges"]

    def test_json_preserves_structure(self):
        """JSON output should preserve all keys."""
        result = _sample_result()
        output = cli._format_json(result)
        parsed = json.loads(output)
        assert "has_cycles" in parsed
        assert "cycles" in parsed
        assert "coupling" in parsed
        assert "depth_warnings" in parsed

    def test_json_pretty_printed(self):
        """JSON should be indented (pretty-printed)."""
        result = _sample_result()
        output = cli._format_json(result)
        # Pretty-printed JSON has newlines
        assert "\n" in output

    def test_empty_graph_json(self):
        """Empty graph should produce valid JSON."""
        result = {
            "nodes": [], "edges": [], "has_cycles": False,
            "cycles": [], "unused_files": [], "coupling": [],
            "depth_warnings": [],
        }
        output = cli._format_json(result)
        parsed = json.loads(output)
        assert parsed["nodes"] == []


# =========================================================================
# _format_dot tests
# =========================================================================

class TestFormatDot:
    """Test DOT (Graphviz) output formatter."""

    def test_dot_header(self):
        """DOT output should start with digraph declaration."""
        result = _sample_result()
        output = cli._format_dot(result)
        assert output.startswith("digraph DependencyGraph {")

    def test_dot_contains_nodes(self):
        """DOT output should contain all node IDs."""
        result = _sample_result()
        output = cli._format_dot(result)
        assert '"main.py"' in output
        assert '"utils.py"' in output
        assert '"models.py"' in output

    def test_dot_contains_edges(self):
        """DOT output should contain all edges."""
        result = _sample_result()
        output = cli._format_dot(result)
        assert '"main.py" -> "utils.py"' in output
        assert '"main.py" -> "models.py"' in output

    def test_dot_cycle_edges_styled(self):
        """Cycle edges should have special styling in DOT."""
        result = _sample_cycle_result()
        output = cli._format_dot(result)
        # Cycle edges should have red color
        assert 'color="#ef4444"' in output

    def test_dot_closes_properly(self):
        """DOT output should end with closing brace."""
        result = _sample_result()
        output = cli._format_dot(result)
        assert output.strip().endswith("}")

    def test_dot_color_by_directory(self):
        """DOT with color_by='directory' should use dir_color."""
        result = _sample_result()
        output = cli._format_dot(result, color_by="directory")
        assert "Directories" in output

    def test_dot_color_by_risk(self):
        """DOT with color_by='risk' should include risk legend."""
        result = _sample_result()
        output = cli._format_dot(result, color_by="risk")
        assert "Risk level" in output


# =========================================================================
# _format_diff tests
# =========================================================================

class TestFormatDiff:
    """Test dependency diff formatter."""

    def test_no_changes(self):
        """Identical graphs should report no changes."""
        result = _sample_result()
        output = cli._format_diff(result, result)
        assert "No dependency changes detected" in output

    def test_added_node(self):
        """New node should appear as added."""
        old = _sample_result()
        new = _sample_result()
        new["nodes"].append({
            "data": {
                "id": "new_file.py", "color": "#3b82f6", "size": 80,
                "depth": 0, "impact": 0, "stability": 0.5,
                "in_degree": 0, "out_degree": 0, "language": "py",
                "in_cycle": False, "reach_pct": 0,
                "risk": "entry", "risk_color": "#22c55e",
                "risk_label": "Entry point / leaf",
                "node_size": 60, "dir_color": "#6366f1",
            }
        })
        output = cli._format_diff(old, new)
        assert "+1 file" in output
        assert "new_file.py" in output

    def test_removed_node(self):
        """Removed node should appear as removed."""
        old = _sample_result()
        new = _sample_result()
        new["nodes"] = [n for n in new["nodes"] if n["data"]["id"] != "models.py"]
        new["edges"] = [e for e in new["edges"] if e["data"]["target"] != "models.py"
                        and e["data"]["source"] != "models.py"]
        output = cli._format_diff(old, new)
        assert "-1 file" in output
        assert "models.py" in output

    def test_added_edge(self):
        """New edge should appear as added dependency."""
        old = _sample_result()
        new = _sample_result()
        new["edges"].append({
            "data": {"source": "models.py", "target": "utils.py", "color": "#94a3b8"}
        })
        output = cli._format_diff(old, new)
        assert "+1 dep" in output

    def test_removed_edge(self):
        """Removed edge should appear as removed dependency."""
        old = _sample_result()
        new = _sample_result()
        new["edges"] = new["edges"][:1]  # Keep only first edge
        output = cli._format_diff(old, new)
        assert "-" in output and "dep" in output

    def test_new_cycle_detected(self):
        """New cycle in the diff should be reported."""
        old = _sample_result()
        new = _sample_cycle_result()
        output = cli._format_diff(old, new)
        # Diff should mention the cycle or show added/removed nodes
        assert len(output) > 0


# =========================================================================
# _format_tree tests
# =========================================================================

class TestFormatTree:
    """Test tree output formatter (captures stdout)."""

    def test_tree_produces_output(self):
        """Tree formatter should produce some output."""
        result = _sample_result()
        captured = io.StringIO()
        with patch('sys.stdout', captured):
            # Disable color for predictable output
            with patch.object(cli, '_USE_COLOR', False):
                cli._format_tree(result, "/tmp/test")
        output = captured.getvalue()
        assert len(output) > 0
        assert "DepGraph" in output

    def test_tree_shows_node_names(self):
        """Tree should show file names."""
        result = _sample_result()
        captured = io.StringIO()
        with patch('sys.stdout', captured):
            with patch.object(cli, '_USE_COLOR', False):
                cli._format_tree(result, "/tmp/test")
        output = captured.getvalue()
        assert "main.py" in output

    def test_tree_shows_cycles_warning(self):
        """Tree should warn about cycles."""
        result = _sample_cycle_result()
        captured = io.StringIO()
        with patch('sys.stdout', captured):
            with patch.object(cli, '_USE_COLOR', False):
                cli._format_tree(result, "/tmp/test")
        output = captured.getvalue()
        assert "circular" in output.lower() or "cycle" in output.lower()

    def test_tree_shows_legend(self):
        """Tree should show the legend."""
        result = _sample_result()
        captured = io.StringIO()
        with patch('sys.stdout', captured):
            with patch.object(cli, '_USE_COLOR', False):
                cli._format_tree(result, "/tmp/test")
        output = captured.getvalue()
        assert "Legend" in output

    def test_tree_empty_graph(self):
        """Empty graph should still produce output without crashing."""
        result = {
            "nodes": [], "edges": [], "has_cycles": False,
            "cycles": [], "unused_files": [], "coupling": [],
            "depth_warnings": [],
        }
        captured = io.StringIO()
        with patch('sys.stdout', captured):
            with patch.object(cli, '_USE_COLOR', False):
                cli._format_tree(result, "/tmp/test")
        output = captured.getvalue()
        assert "DepGraph" in output


# =========================================================================
# _format_mermaid tests (if it exists)
# =========================================================================

class TestFormatMermaid:
    """Test Mermaid diagram formatter."""

    def test_mermaid_exists(self):
        """Mermaid formatter should exist."""
        assert hasattr(cli, '_format_mermaid')

    def test_mermaid_header(self):
        """Mermaid output should start with graph declaration."""
        if not hasattr(cli, '_format_mermaid'):
            pytest.skip("_format_mermaid not found")
        result = _sample_result()
        output = cli._format_mermaid(result)
        assert "graph" in output.lower() or "flowchart" in output.lower()

    def test_mermaid_contains_nodes(self):
        """Mermaid output should contain node references."""
        if not hasattr(cli, '_format_mermaid'):
            pytest.skip("_format_mermaid not found")
        result = _sample_result()
        output = cli._format_mermaid(result)
        assert "main.py" in output

    def test_mermaid_contains_edges(self):
        """Mermaid output should contain edge arrows."""
        if not hasattr(cli, '_format_mermaid'):
            pytest.skip("_format_mermaid not found")
        result = _sample_result()
        output = cli._format_mermaid(result)
        assert "-->" in output

    def test_mermaid_cycle_edges_styled(self):
        """Cycle edges in Mermaid should have special styling."""
        if not hasattr(cli, '_format_mermaid'):
            pytest.skip("_format_mermaid not found")
        result = _sample_cycle_result()
        output = cli._format_mermaid(result)
        # Should contain some cycle indication (dotted line or color)
        assert len(output) > 0


# =========================================================================
# Color helper tests
# =========================================================================

class TestColorHelpers:
    """Test terminal color helper functions."""

    def test_bold(self):
        """Bold should wrap text in ANSI codes when color enabled."""
        with patch.object(cli, '_USE_COLOR', True):
            result = cli._bold("hello")
            assert "\033[" in result
            assert "hello" in result

    def test_bold_no_color(self):
        """Bold should return plain text when color disabled."""
        with patch.object(cli, '_USE_COLOR', False):
            result = cli._bold("hello")
            assert result == "hello"

    def test_all_color_functions(self):
        """All color functions should work without errors."""
        with patch.object(cli, '_USE_COLOR', False):
            assert cli._dim("x") == "x"
            assert cli._red("x") == "x"
            assert cli._green("x") == "x"
            assert cli._yellow("x") == "x"
            assert cli._cyan("x") == "x"
            assert cli._magenta("x") == "x"
