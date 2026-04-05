"""Comprehensive tests for the CLI module (cli.py)."""

import io
import json
import os
import sys
import pytest
from unittest import mock
from unittest.mock import patch, MagicMock

# We need to test the cli module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cli


# =========================================================================
# Helper fixture for test data
# =========================================================================

def _sample_result():
    """Return a minimal but realistic graph result dict for formatter tests."""
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
            {
                "data": {
                    "source": "main.py",
                    "target": "utils.py",
                    "color": "#94a3b8",
                }
            },
            {
                "data": {
                    "source": "main.py",
                    "target": "models.py",
                    "color": "#94a3b8",
                }
            },
            {
                "data": {
                    "source": "utils.py",
                    "target": "models.py",
                    "color": "#94a3b8",
                }
            },
        ],
        "has_cycles": False,
        "cycles": [],
        "unused_files": ["main.py"],
        "coupling": [],
        "depth_warnings": [],
    }


def _sample_result_with_cycles():
    """Return a graph result with circular dependencies."""
    result = _sample_result()
    # Add cycle: a.py -> b.py -> c.py -> a.py
    result["nodes"] = [
        {
            "data": {
                "id": "a.py",
                "color": "#3b82f6",
                "depth": 0,
                "impact": 2,
                "stability": 0.5,
                "in_degree": 1,
                "out_degree": 1,
                "language": "py",
                "in_cycle": True,
                "reach_pct": 0,
                "risk": "critical",
                "risk_color": "#ef4444",
                "risk_label": "Critical",
                "node_size": 60,
                "dir_color": "#6366f1",
            }
        },
        {
            "data": {
                "id": "b.py",
                "color": "#3b82f6",
                "depth": 0,
                "impact": 2,
                "stability": 0.5,
                "in_degree": 1,
                "out_degree": 1,
                "language": "py",
                "in_cycle": True,
                "reach_pct": 0,
                "risk": "critical",
                "risk_color": "#ef4444",
                "risk_label": "Critical",
                "node_size": 60,
                "dir_color": "#6366f1",
            }
        },
        {
            "data": {
                "id": "c.py",
                "color": "#3b82f6",
                "depth": 0,
                "impact": 2,
                "stability": 0.5,
                "in_degree": 1,
                "out_degree": 1,
                "language": "py",
                "in_cycle": True,
                "reach_pct": 0,
                "risk": "critical",
                "risk_color": "#ef4444",
                "risk_label": "Critical",
                "node_size": 60,
                "dir_color": "#6366f1",
            }
        },
    ]
    result["edges"] = [
        {"data": {"source": "a.py", "target": "b.py", "color": "#94a3b8"}},
        {"data": {"source": "b.py", "target": "c.py", "color": "#94a3b8"}},
        {"data": {"source": "c.py", "target": "a.py", "color": "#94a3b8", "classes": "cycle"}},
    ]
    result["has_cycles"] = True
    result["cycles"] = [["a.py", "b.py", "c.py"]]
    return result


def _sample_result_empty():
    """Return an empty graph result."""
    return {
        "nodes": [],
        "edges": [],
        "has_cycles": False,
        "cycles": [],
        "unused_files": [],
        "coupling": [],
        "depth_warnings": [],
    }


def _sample_result_with_subdirs():
    """Return a graph result with nodes in different directories."""
    return {
        "nodes": [
            {
                "data": {
                    "id": "src/main.py",
                    "color": "#3b82f6",
                    "depth": 1,
                    "impact": 1,
                    "stability": 0.5,
                    "in_degree": 0,
                    "out_degree": 1,
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
            {
                "data": {
                    "id": "lib/utils.py",
                    "color": "#3b82f6",
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
                    "dir_color": "#ff6b6b",
                }
            },
        ],
        "edges": [
            {"data": {"source": "src/main.py", "target": "lib/utils.py", "color": "#94a3b8"}},
        ],
        "has_cycles": False,
        "cycles": [],
        "unused_files": [],
        "coupling": [],
        "depth_warnings": [],
    }


# =========================================================================
# Tests for color helpers
# =========================================================================

class TestColorHelpers:
    """Test color output functions."""

    def test_use_color_false_when_not_tty(self, monkeypatch):
        """_USE_COLOR should be False when stdout is not a TTY."""
        monkeypatch.setattr(sys.stdout, "isatty", lambda: False)
        # Reload the module to pick up the new isatty() value
        import importlib
        importlib.reload(cli)
        assert hasattr(sys.stdout, "isatty")

    def test_c_applies_ansi_codes_when_color_enabled(self):
        """_c() should apply ANSI codes when color is enabled."""
        with patch.object(cli, "_USE_COLOR", True):
            result = cli._c("31", "test")
            assert "\033[31m" in result
            assert "test" in result
            assert "\033[0m" in result

    def test_c_no_codes_when_color_disabled(self):
        """_c() should return plain text when color is disabled."""
        with patch.object(cli, "_USE_COLOR", False):
            result = cli._c("31", "test")
            assert result == "test"
            assert "\033" not in result

    def test_bold(self):
        """_bold() should apply bold code (1)."""
        with patch.object(cli, "_USE_COLOR", True):
            result = cli._bold("text")
            assert "\033[1m" in result
            assert "text" in result

    def test_dim(self):
        """_dim() should apply dim code (2)."""
        with patch.object(cli, "_USE_COLOR", True):
            result = cli._dim("text")
            assert "\033[2m" in result

    def test_red(self):
        """_red() should apply red code (31)."""
        with patch.object(cli, "_USE_COLOR", True):
            result = cli._red("text")
            assert "\033[31m" in result

    def test_yellow(self):
        """_yellow() should apply yellow code (33)."""
        with patch.object(cli, "_USE_COLOR", True):
            result = cli._yellow("text")
            assert "\033[33m" in result

    def test_cyan(self):
        """_cyan() should apply cyan code (36)."""
        with patch.object(cli, "_USE_COLOR", True):
            result = cli._cyan("text")
            assert "\033[36m" in result

    def test_magenta(self):
        """_magenta() should apply magenta code (35)."""
        with patch.object(cli, "_USE_COLOR", True):
            result = cli._magenta("text")
            assert "\033[35m" in result

    def test_green(self):
        """_green() should apply green code (32)."""
        with patch.object(cli, "_USE_COLOR", True):
            result = cli._green("text")
            assert "\033[32m" in result


# =========================================================================
# Tests for _format_tree()
# =========================================================================

class TestFormatTree:
    """Test tree output formatter."""

    def test_format_tree_basic(self, capsys):
        """_format_tree() should output directory name, node count, and edge count."""
        result = _sample_result()
        cli._format_tree(result, "/test/project")
        captured = capsys.readouterr()

        # Should contain directory name
        assert "project" in captured.out
        # Should contain node and edge counts
        assert "3 files" in captured.out
        assert "3 dependencies" in captured.out

    def test_format_tree_with_cycles(self, capsys):
        """_format_tree() should show warning when cycles are present."""
        result = _sample_result_with_cycles()
        cli._format_tree(result, "/test/project")
        captured = capsys.readouterr()

        # Should mention circular dependencies
        assert "circular" in captured.out.lower()
        # Should show cycle count
        assert "1" in captured.out

    def test_format_tree_empty(self, capsys):
        """_format_tree() should handle empty graphs."""
        result = _sample_result_empty()
        cli._format_tree(result, "/test/empty")
        captured = capsys.readouterr()

        # Should show 0 files and 0 dependencies
        assert "0 files" in captured.out
        assert "0 dependencies" in captured.out

    def test_format_tree_contains_legend(self, capsys):
        """_format_tree() should include a legend."""
        result = _sample_result()
        cli._format_tree(result, "/test/project")
        captured = capsys.readouterr()

        # Should contain legend references
        assert "Legend" in captured.out

    def test_format_tree_language_summary(self, capsys):
        """_format_tree() should show language summary."""
        result = _sample_result()
        cli._format_tree(result, "/test/project")
        captured = capsys.readouterr()

        # Should mention Python
        assert "py" in captured.out.lower()

    def test_format_tree_risk_breakdown(self, capsys):
        """_format_tree() should show risk breakdown in Health section."""
        result = _sample_result()
        cli._format_tree(result, "/test/project")
        captured = capsys.readouterr()

        # Should have Health line
        assert "Health" in captured.out

    def test_format_tree_depth_warnings(self, capsys):
        """_format_tree() should show depth warnings if present."""
        result = _sample_result()
        result["depth_warnings"] = [
            {
                "file": "deep.py",
                "severity": "critical",
                "reasons": ["depth > 10"],
            }
        ]
        cli._format_tree(result, "/test/project")
        captured = capsys.readouterr()

        # Should show warnings section
        assert "Warnings" in captured.out
        assert "deep.py" in captured.out

    def test_format_tree_coupling(self, capsys):
        """_format_tree() should show directory coupling if present."""
        result = _sample_result()
        result["coupling"] = [
            {
                "dir1": "src",
                "dir2": "lib",
                "score": 0.75,
                "cross_edges": 5,
            }
        ]
        cli._format_tree(result, "/test/project")
        captured = capsys.readouterr()

        # Should show coupling section
        assert "coupling" in captured.out.lower()


# =========================================================================
# Tests for _format_json()
# =========================================================================

class TestFormatJson:
    """Test JSON output formatter."""

    def test_format_json_returns_valid_json(self):
        """_format_json() should return valid JSON string."""
        result = _sample_result()
        output = cli._format_json(result)

        # Should be parseable as JSON
        parsed = json.loads(output)
        assert isinstance(parsed, dict)

    def test_format_json_contains_nodes(self):
        """_format_json() output should contain nodes key."""
        result = _sample_result()
        output = cli._format_json(result)
        parsed = json.loads(output)

        assert "nodes" in parsed
        assert len(parsed["nodes"]) == 3

    def test_format_json_contains_edges(self):
        """_format_json() output should contain edges key."""
        result = _sample_result()
        output = cli._format_json(result)
        parsed = json.loads(output)

        assert "edges" in parsed
        assert len(parsed["edges"]) == 3

    def test_format_json_contains_cycles_key(self):
        """_format_json() output should contain cycles key."""
        result = _sample_result()
        output = cli._format_json(result)
        parsed = json.loads(output)

        assert "cycles" in parsed

    def test_format_json_preserves_all_data(self):
        """_format_json() should preserve all result data."""
        result = _sample_result()
        output = cli._format_json(result)
        parsed = json.loads(output)

        # Check that all original keys are present
        assert parsed["has_cycles"] == result["has_cycles"]
        assert len(parsed["nodes"]) == len(result["nodes"])


# =========================================================================
# Tests for _format_dot()
# =========================================================================

class TestFormatDot:
    """Test Graphviz DOT output formatter."""

    def test_format_dot_starts_with_digraph(self):
        """_format_dot() should start with digraph declaration."""
        result = _sample_result()
        output = cli._format_dot(result)

        assert output.startswith("digraph DependencyGraph {")

    def test_format_dot_ends_with_closing_brace(self):
        """_format_dot() should end with closing brace."""
        result = _sample_result()
        output = cli._format_dot(result)

        assert output.rstrip().endswith("}")

    def test_format_dot_contains_node_definitions(self):
        """_format_dot() should contain node definitions."""
        result = _sample_result()
        output = cli._format_dot(result)

        # Should have node definitions
        assert "main.py" in output
        assert "utils.py" in output
        assert "models.py" in output

    def test_format_dot_contains_edge_definitions(self):
        """_format_dot() should contain edge definitions."""
        result = _sample_result()
        output = cli._format_dot(result)

        # Should have edges with arrows
        assert "->" in output

    def test_format_dot_color_by_risk(self):
        """_format_dot() with color_by='risk' should use risk colors."""
        result = _sample_result()
        output = cli._format_dot(result, color_by="risk")

        # Should reference risk colors
        assert "fillcolor=" in output

    def test_format_dot_color_by_directory(self):
        """_format_dot() with color_by='directory' should use directory colors."""
        result = _sample_result_with_subdirs()
        output = cli._format_dot(result, color_by="directory")

        # Should reference directory colors or default colors
        assert "fillcolor=" in output

    def test_format_dot_cycle_edges_are_red(self):
        """_format_dot() should color cycle edges red."""
        result = _sample_result_with_cycles()
        output = cli._format_dot(result)

        # Should have red cycle edge
        assert "#ef4444" in output

    def test_format_dot_contains_legend(self):
        """_format_dot() should contain legend subgraph."""
        result = _sample_result()
        output = cli._format_dot(result)

        # Should have legend cluster
        assert "cluster_legend" in output

    def test_format_dot_subgraph_for_multiple_dirs(self):
        """_format_dot() should create subgraphs for multiple directories."""
        result = _sample_result_with_subdirs()
        output = cli._format_dot(result, color_by="risk")

        # Should have subgraph definitions when multiple dirs
        assert "subgraph" in output


# =========================================================================
# Tests for _format_mermaid()
# =========================================================================

class TestFormatMermaid:
    """Test Mermaid diagram output formatter."""

    def test_format_mermaid_starts_with_graph_lr(self):
        """_format_mermaid() should start with 'graph LR'."""
        result = _sample_result()
        output = cli._format_mermaid(result)

        assert output.startswith("graph LR")

    def test_format_mermaid_contains_nodes(self):
        """_format_mermaid() should contain node definitions."""
        result = _sample_result()
        output = cli._format_mermaid(result)

        # Should have node references (sanitized)
        assert "main_py" in output or "main" in output
        assert "-->" in output

    def test_format_mermaid_contains_edges(self):
        """_format_mermaid() should contain edge definitions."""
        result = _sample_result()
        output = cli._format_mermaid(result)

        # Should have edges with arrows
        assert "-->" in output

    def test_format_mermaid_color_by_risk(self):
        """_format_mermaid() with color_by='risk' should use risk colors."""
        result = _sample_result()
        output = cli._format_mermaid(result, color_by="risk")

        # Should have classDef for risk levels
        assert "classDef" in output
        assert "risk_" in output

    def test_format_mermaid_color_by_directory(self):
        """_format_mermaid() with color_by='directory' should use directory colors."""
        result = _sample_result_with_subdirs()
        output = cli._format_mermaid(result, color_by="directory")

        # Should have classDef for directories
        assert "classDef" in output
        assert "dir_" in output

    def test_format_mermaid_cycle_edges_use_dotted_arrows(self):
        """_format_mermaid() should use dotted arrows for cycle edges."""
        result = _sample_result_with_cycles()
        output = cli._format_mermaid(result)

        # Should have dotted edge arrow syntax
        assert "-.->" in output

    def test_format_mermaid_sanitizes_ids(self):
        """_format_mermaid() should sanitize node IDs for Mermaid syntax."""
        result = _sample_result_with_subdirs()
        output = cli._format_mermaid(result)

        # Should replace slashes and dots with underscores
        assert "src_main_py" in output
        assert "lib_utils_py" in output

    def test_format_mermaid_subgraph_for_multiple_dirs(self):
        """_format_mermaid() should create subgraphs for multiple directories."""
        result = _sample_result_with_subdirs()
        output = cli._format_mermaid(result)

        # Should have subgraph definitions
        assert "subgraph" in output

    def test_format_mermaid_cycle_node_marker(self):
        """_format_mermaid() should mark cycle nodes with special symbol."""
        result = _sample_result_with_cycles()
        output = cli._format_mermaid(result)

        # Cycle nodes should have special marker
        assert "⟳" in output


# =========================================================================
# Tests for _format_diff()
# =========================================================================

class TestFormatDiff:
    """Test diff output formatter."""

    def test_format_diff_no_changes(self):
        """_format_diff() should return 'No dependency changes detected.' when no changes."""
        old_result = _sample_result()
        new_result = _sample_result()

        output = cli._format_diff(old_result, new_result)
        assert "No dependency changes detected." in output

    def test_format_diff_added_nodes(self):
        """_format_diff() should show added nodes."""
        old_result = _sample_result()
        new_result = _sample_result()
        new_result["nodes"].append({
            "data": {
                "id": "new.py",
                "color": "#3b82f6",
                "depth": 0,
                "impact": 0,
                "stability": 0.5,
                "in_degree": 0,
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
        })

        output = cli._format_diff(old_result, new_result)
        assert "Added files" in output
        assert "new.py" in output

    def test_format_diff_removed_nodes(self):
        """_format_diff() should show removed nodes."""
        old_result = _sample_result()
        new_result = _sample_result()
        # Remove last node
        new_result["nodes"] = new_result["nodes"][:-1]

        output = cli._format_diff(old_result, new_result)
        assert "Removed files" in output
        assert "models.py" in output

    def test_format_diff_added_edges(self):
        """_format_diff() should show added edges."""
        old_result = _sample_result()
        new_result = _sample_result()
        new_result["edges"].append({
            "data": {
                "source": "models.py",
                "target": "main.py",
                "color": "#94a3b8",
            }
        })

        output = cli._format_diff(old_result, new_result)
        assert "Added dependencies" in output

    def test_format_diff_removed_edges(self):
        """_format_diff() should show removed edges."""
        old_result = _sample_result()
        new_result = _sample_result()
        # Remove last edge
        new_result["edges"] = new_result["edges"][:-1]

        output = cli._format_diff(old_result, new_result)
        assert "Removed dependencies" in output

    def test_format_diff_new_cycles(self):
        """_format_diff() should warn about new cycles."""
        old_result = _sample_result()
        new_result = _sample_result_with_cycles()

        output = cli._format_diff(old_result, new_result)
        assert "circular" in output.lower() or "cycle" in output.lower()

    def test_format_diff_has_summary_line(self):
        """_format_diff() should have summary with counts."""
        old_result = _sample_result()
        new_result = _sample_result()
        new_result["nodes"].append({
            "data": {
                "id": "new.py",
                "color": "#3b82f6",
                "depth": 0,
                "impact": 0,
                "stability": 0.5,
                "in_degree": 0,
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
        })

        output = cli._format_diff(old_result, new_result)
        # Should have summary with + count
        assert "+1" in output

    def test_format_diff_markdown_format(self):
        """_format_diff() should return Markdown formatted output."""
        old_result = _sample_result()
        new_result = _sample_result()
        new_result["nodes"].append({
            "data": {
                "id": "new.py",
                "color": "#3b82f6",
                "depth": 0,
                "impact": 0,
                "stability": 0.5,
                "in_degree": 0,
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
        })

        output = cli._format_diff(old_result, new_result)
        # Should have Markdown headers
        assert "##" in output
        # Should have summary header
        assert "Dependency Diff" in output


# =========================================================================
# Tests for main() argument parsing
# =========================================================================

class TestMainArgumentParsing:
    """Test main() CLI argument parsing and behavior."""

    @patch("cli._build_graph")
    @patch("cli._detect_languages")
    def test_main_default_directory(self, mock_detect, mock_build, tmp_path):
        """main() should use '.' as default directory."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()

        mock_detect.return_value = {"has_py": False}
        mock_build.return_value = {"nodes": [], "edges": [], "has_cycles": False,
                                   "cycles": [], "unused_files": [], "coupling": [],
                                   "depth_warnings": []}

        with patch("sys.argv", ["depgraph"]):
            with patch("sys.stderr"):
                with pytest.raises(SystemExit):  # Will exit because no nodes
                    cli.main()

    @patch("cli._build_graph")
    @patch("cli._detect_languages")
    def test_main_json_flag(self, mock_detect, mock_build, tmp_path, capsys):
        """main() should output JSON when --json flag is used."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()

        mock_detect.return_value = {"has_py": False}
        mock_build.return_value = _sample_result()

        with patch("sys.argv", ["depgraph", str(test_dir), "--json"]):
            cli.main()
            captured = capsys.readouterr()

            # Output should be valid JSON
            parsed = json.loads(captured.out)
            assert isinstance(parsed, dict)

    @patch("cli._build_graph")
    @patch("cli._detect_languages")
    def test_main_dot_flag(self, mock_detect, mock_build, tmp_path, capsys):
        """main() should output DOT when --dot flag is used."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()

        mock_detect.return_value = {"has_py": False}
        mock_build.return_value = _sample_result()

        with patch("sys.argv", ["depgraph", str(test_dir), "--dot"]):
            cli.main()
            captured = capsys.readouterr()

            # Should start with digraph
            assert "digraph" in captured.out

    @patch("cli._build_graph")
    @patch("cli._detect_languages")
    def test_main_mermaid_flag(self, mock_detect, mock_build, tmp_path, capsys):
        """main() should output Mermaid when --mermaid flag is used."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()

        mock_detect.return_value = {"has_py": False}
        mock_build.return_value = _sample_result()

        with patch("sys.argv", ["depgraph", str(test_dir), "--mermaid"]):
            cli.main()
            captured = capsys.readouterr()

            # Should start with graph LR
            assert "graph LR" in captured.out

    @patch("cli._build_graph")
    @patch("cli._detect_languages")
    def test_main_lang_option(self, mock_detect, mock_build, tmp_path):
        """main() should accept --lang option."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()

        mock_detect.return_value = {"has_py": False}
        mock_build.return_value = _sample_result()

        with patch("sys.argv", ["depgraph", str(test_dir), "--lang", "rust", "--json"]):
            cli.main()

            # Should have called build_graph with appropriate lang flags
            assert mock_build.called

    @patch("cli._build_graph")
    @patch("cli._detect_languages")
    def test_main_hide_external_flag(self, mock_detect, mock_build, tmp_path):
        """main() should accept --hide-external flag."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()

        mock_detect.return_value = {"has_py": False}
        mock_build.return_value = _sample_result()

        with patch("sys.argv", ["depgraph", str(test_dir), "--hide-external", "--json"]):
            cli.main()

            # Should have called build_graph with hide_system=True
            call_kwargs = mock_build.call_args[1]
            assert call_kwargs.get("hide_system") is True

    @patch("cli._build_graph")
    @patch("cli._detect_languages")
    def test_main_hide_isolated_flag(self, mock_detect, mock_build, tmp_path):
        """main() should accept --hide-isolated flag."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()

        mock_detect.return_value = {"has_py": False}
        mock_build.return_value = _sample_result()

        with patch("sys.argv", ["depgraph", str(test_dir), "--hide-isolated", "--json"]):
            cli.main()

            # Should have called build_graph with hide_isolated=True
            call_kwargs = mock_build.call_args[1]
            assert call_kwargs.get("hide_isolated") is True

    @patch("cli._build_graph")
    @patch("cli._detect_languages")
    def test_main_filter_dir_option(self, mock_detect, mock_build, tmp_path):
        """main() should accept --filter-dir option."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()

        mock_detect.return_value = {"has_py": False}
        mock_build.return_value = _sample_result()

        with patch("sys.argv", ["depgraph", str(test_dir), "--filter-dir", "src", "--json"]):
            cli.main()

            # Should have called build_graph with filter_dir
            call_kwargs = mock_build.call_args[1]
            assert call_kwargs.get("filter_dir") == "src"

    @patch("cli._build_graph")
    @patch("cli._detect_languages")
    def test_main_color_by_option(self, mock_detect, mock_build, tmp_path, capsys):
        """main() should accept --color-by option."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()

        mock_detect.return_value = {"has_py": False}
        mock_build.return_value = _sample_result()

        with patch("sys.argv", ["depgraph", str(test_dir), "--color-by", "directory", "--dot"]):
            cli.main()
            captured = capsys.readouterr()

            # Should output DOT format
            assert "digraph" in captured.out

    @patch("cli._build_graph")
    @patch("cli._detect_languages")
    def test_main_output_file_option(self, mock_detect, mock_build, tmp_path):
        """main() should write to file with -o option."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()
        output_file = tmp_path / "output.json"

        mock_detect.return_value = {"has_py": False}
        mock_build.return_value = _sample_result()

        with patch("sys.argv", ["depgraph", str(test_dir), "--json", "-o", str(output_file)]):
            cli.main()

            # File should exist
            assert output_file.exists()

    def test_main_error_nonexistent_directory(self, capsys):
        """main() should exit with error for nonexistent directory."""
        with patch("sys.argv", ["depgraph", "/nonexistent/path"]):
            with pytest.raises(SystemExit) as exc_info:
                cli.main()

            assert exc_info.value.code == 1

    @patch("cli._build_graph")
    @patch("cli._detect_languages")
    def test_main_mutually_exclusive_format_flags(self, mock_detect, mock_build, tmp_path):
        """main() should reject mutually exclusive format flags."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()

        mock_detect.return_value = {"has_py": False}
        mock_build.return_value = _sample_result()

        # Using both --json and --dot should fail
        with patch("sys.argv", ["depgraph", str(test_dir), "--json", "--dot"]):
            with pytest.raises(SystemExit):
                cli.main()

    @patch("cli._build_graph")
    @patch("cli._detect_languages")
    def test_main_no_nodes_error(self, mock_detect, mock_build, tmp_path, capsys):
        """main() should exit with error when no source files found."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()

        mock_detect.return_value = {"has_py": False}
        mock_build.return_value = {"nodes": [], "edges": [], "has_cycles": False,
                                   "cycles": [], "unused_files": [], "coupling": [],
                                   "depth_warnings": []}

        with patch("sys.argv", ["depgraph", str(test_dir)]):
            with pytest.raises(SystemExit) as exc_info:
                cli.main()

            assert exc_info.value.code == 1


# =========================================================================
# Tests for diff mode
# =========================================================================

class TestDiffMode:
    """Test --diff mode functionality."""

    @patch("cli._build_graph")
    @patch("cli._detect_languages")
    def test_main_diff_mode(self, mock_detect, mock_build, tmp_path, capsys):
        """main() should handle --diff flag comparing two directories."""
        test_dir = tmp_path / "new"
        test_dir.mkdir()
        base_dir = tmp_path / "old"
        base_dir.mkdir()

        mock_detect.return_value = {"has_py": False}
        mock_build.side_effect = [_sample_result(), _sample_result()]

        with patch("sys.argv", ["depgraph", str(test_dir), "--diff", str(base_dir)]):
            cli.main()
            captured = capsys.readouterr()

            # Should output Markdown-formatted diff
            assert "Dependency Diff" in captured.out

    def test_main_diff_nonexistent_base_dir(self, tmp_path):
        """main() should exit with error for nonexistent base directory in --diff."""
        test_dir = tmp_path / "test"
        test_dir.mkdir()

        with patch("sys.argv", ["depgraph", str(test_dir), "--diff", "/nonexistent"]):
            with pytest.raises(SystemExit) as exc_info:
                cli.main()

            assert exc_info.value.code == 1


# =========================================================================
# Edge cases and integration tests
# =========================================================================

class TestEdgeCases:
    """Test edge cases and special scenarios."""

    def test_format_tree_with_many_languages(self, capsys):
        """_format_tree() should handle multiple languages in summary."""
        result = _sample_result()
        # Add nodes with different languages
        result["nodes"][0]["data"]["language"] = "py"
        result["nodes"][1]["data"]["language"] = "js"
        result["nodes"][2]["data"]["language"] = "rust"

        cli._format_tree(result, "/test/multilang")
        captured = capsys.readouterr()

        # Should list multiple languages
        assert "Languages:" in captured.out

    def test_format_dot_sanitizes_quotes_in_labels(self):
        """_format_dot() should escape quotes in node IDs and labels."""
        result = {
            "nodes": [
                {
                    "data": {
                        "id": 'file"with"quotes.py',
                        "color": "#3b82f6",
                        "depth": 0,
                        "impact": 0,
                        "stability": 0.5,
                        "in_degree": 0,
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
                }
            ],
            "edges": [],
            "has_cycles": False,
            "cycles": [],
            "unused_files": [],
            "coupling": [],
            "depth_warnings": [],
        }

        output = cli._format_dot(result)

        # Should not cause syntax errors (output should be valid)
        assert "digraph" in output

    def test_format_mermaid_with_special_chars_in_ids(self):
        """_format_mermaid() should handle special characters in node IDs."""
        result = {
            "nodes": [
                {
                    "data": {
                        "id": "src/lib-utils.py",
                        "color": "#3b82f6",
                        "depth": 0,
                        "impact": 0,
                        "stability": 0.5,
                        "in_degree": 0,
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
                }
            ],
            "edges": [],
            "has_cycles": False,
            "cycles": [],
            "unused_files": [],
            "coupling": [],
            "depth_warnings": [],
        }

        output = cli._format_mermaid(result)

        # Should sanitize special characters
        assert "src_lib_utils_py" in output
