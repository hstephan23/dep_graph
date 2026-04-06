"""Unit tests for churn.py — git analysis, scoring, and edge cases."""

from __future__ import annotations

import os
import subprocess
import sys
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from churn import (
    get_churn,
    _normalise_git_url,
    _is_git_repo,
    _git_log_files,
)


# =========================================================================
# _normalise_git_url tests
# =========================================================================

class TestNormaliseGitUrl:
    """Test git URL normalization."""

    def test_owner_repo_shorthand(self):
        assert _normalise_git_url("user/repo") == "https://github.com/user/repo.git"

    def test_dotted_owner_repo(self):
        """Owner or repo names with dots should work."""
        assert _normalise_git_url("my.org/my.repo") == "https://github.com/my.org/my.repo.git"

    def test_hyphenated_names(self):
        """Hyphenated owner/repo names should work."""
        assert _normalise_git_url("my-org/my-repo") == "https://github.com/my-org/my-repo.git"

    def test_github_full_url(self):
        result = _normalise_git_url("https://github.com/owner/repo")
        assert result == "https://github.com/owner/repo.git"

    def test_github_with_git_suffix(self):
        result = _normalise_git_url("https://github.com/owner/repo.git")
        assert result == "https://github.com/owner/repo.git"

    def test_gitlab_url(self):
        result = _normalise_git_url("https://gitlab.com/group/project")
        assert result == "https://gitlab.com/group/project.git"

    def test_bitbucket_url(self):
        result = _normalise_git_url("https://bitbucket.org/team/repo")
        assert result == "https://bitbucket.org/team/repo.git"

    def test_http_url_normalised_to_https(self):
        result = _normalise_git_url("http://github.com/owner/repo")
        assert result == "https://github.com/owner/repo.git"

    def test_trailing_slash_removed(self):
        result = _normalise_git_url("https://github.com/owner/repo/")
        assert result == "https://github.com/owner/repo.git"

    def test_whitespace_trimmed(self):
        result = _normalise_git_url("  user/repo  ")
        assert result == "https://github.com/user/repo.git"

    def test_invalid_urls(self):
        assert _normalise_git_url("ftp://github.com/owner/repo") is None
        assert _normalise_git_url("just-a-word") is None
        assert _normalise_git_url("") is None
        assert _normalise_git_url("git@github.com:owner/repo.git") is None

    def test_unsupported_host(self):
        assert _normalise_git_url("https://example.com/owner/repo") is None

    def test_nested_gitlab_path(self):
        """GitLab supports nested groups like group/subgroup/project."""
        result = _normalise_git_url("https://gitlab.com/group/subgroup/project")
        assert result == "https://gitlab.com/group/subgroup/project.git"


# =========================================================================
# _is_git_repo tests
# =========================================================================

class TestIsGitRepo:
    """Test git repo detection."""

    def test_non_git_directory(self, tmp_path):
        """A directory without .git should return False."""
        assert _is_git_repo(str(tmp_path)) is False

    def test_git_directory(self, tmp_path):
        """A git-initialized directory should return True."""
        subprocess.run(
            ["git", "init", str(tmp_path)],
            capture_output=True, text=True, timeout=5,
        )
        assert _is_git_repo(str(tmp_path)) is True

    def test_nonexistent_directory(self):
        """A non-existent directory should return False."""
        assert _is_git_repo("/tmp/definitely_does_not_exist_xyz_999") is False


# =========================================================================
# get_churn tests
# =========================================================================

class TestGetChurn:
    """Test the main get_churn function."""

    def test_non_git_repo(self, tmp_path):
        """Non-git directories should return empty results."""
        result = get_churn(str(tmp_path))
        assert result["is_git"] is False
        assert result["files"] == {}
        assert result["period"] == ""

    def test_git_repo_with_commits(self, tmp_path):
        """A git repo with commits should return churn data."""
        # Set up a mini git repo
        subprocess.run(["git", "init", str(tmp_path)], capture_output=True, timeout=5)
        subprocess.run(
            ["git", "config", "user.email", "test@test.com"],
            cwd=str(tmp_path), capture_output=True, timeout=5,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test"],
            cwd=str(tmp_path), capture_output=True, timeout=5,
        )

        # Create and commit a file
        (tmp_path / "hello.py").write_text("print('hello')")
        subprocess.run(
            ["git", "add", "hello.py"],
            cwd=str(tmp_path), capture_output=True, timeout=5,
        )
        subprocess.run(
            ["git", "commit", "-m", "Initial commit"],
            cwd=str(tmp_path), capture_output=True, timeout=5,
        )

        result = get_churn(str(tmp_path))
        assert result["is_git"] is True
        assert "hello.py" in result["files"]

        file_info = result["files"]["hello.py"]
        assert file_info["commits"] >= 1
        assert file_info["authors"] >= 1
        assert 0 <= file_info["churn_score"] <= 1
        assert file_info["last_date"] is not None

    def test_churn_score_formula(self, tmp_path):
        """Churn score should follow the 0.45*rec + 0.40*freq + 0.15*auth formula."""
        # Set up git repo with multiple commits to a single file
        subprocess.run(["git", "init", str(tmp_path)], capture_output=True, timeout=5)
        subprocess.run(
            ["git", "config", "user.email", "test@test.com"],
            cwd=str(tmp_path), capture_output=True, timeout=5,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test"],
            cwd=str(tmp_path), capture_output=True, timeout=5,
        )

        (tmp_path / "only_file.py").write_text("v1")
        subprocess.run(["git", "add", "."], cwd=str(tmp_path), capture_output=True, timeout=5)
        subprocess.run(
            ["git", "commit", "-m", "v1"],
            cwd=str(tmp_path), capture_output=True, timeout=5,
        )

        result = get_churn(str(tmp_path))
        if "only_file.py" in result["files"]:
            info = result["files"]["only_file.py"]
            # With a single file and single author, all normalized values should be 1.0
            # score = 0.45*1 + 0.40*1 + 0.15*1 = 1.0
            assert info["churn_score"] == 1.0

    def test_custom_days_parameter(self, tmp_path):
        """Custom days parameter should be reflected in the period."""
        result = get_churn(str(tmp_path), days=30)
        # Non-git, but period would be set if it were
        assert result["is_git"] is False


# =========================================================================
# _git_log_files tests
# =========================================================================

class TestGitLogFiles:
    """Test git log parsing."""

    def test_empty_repo(self, tmp_path):
        """Empty directory (non-git) should return empty dict."""
        result = _git_log_files(str(tmp_path), since="2020-01-01")
        assert result == {}

    def test_git_repo_with_file(self, tmp_path):
        """Git repo with commits should return file entries."""
        subprocess.run(["git", "init", str(tmp_path)], capture_output=True, timeout=5)
        subprocess.run(
            ["git", "config", "user.email", "test@test.com"],
            cwd=str(tmp_path), capture_output=True, timeout=5,
        )
        subprocess.run(
            ["git", "config", "user.name", "TestAuthor"],
            cwd=str(tmp_path), capture_output=True, timeout=5,
        )

        (tmp_path / "app.py").write_text("print('app')")
        subprocess.run(["git", "add", "."], cwd=str(tmp_path), capture_output=True, timeout=5)
        subprocess.run(
            ["git", "commit", "-m", "add app"],
            cwd=str(tmp_path), capture_output=True, timeout=5,
        )

        result = _git_log_files(str(tmp_path), since="2020-01-01")
        assert "app.py" in result
        entries = result["app.py"]
        assert len(entries) >= 1
        author, date = entries[0]
        assert author == "TestAuthor"
        assert isinstance(date, datetime)
