"""Unit tests for app.py — Flask routes, security, sessions, and validation."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import zipfile
import shutil
import pytest
from unittest.mock import patch, MagicMock

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# We need Flask available to test app.py routes
flask = pytest.importorskip("flask")

import app as app_module


# =========================================================================
# Fixtures
# =========================================================================

@pytest.fixture
def client():
    """Create a Flask test client."""
    app_module.app.config['TESTING'] = True
    # Disable rate limiting for tests
    with patch.object(app_module, '_DEBUG_MODE', True):
        with app_module.app.test_client() as c:
            yield c


@pytest.fixture
def temp_project(tmp_path):
    """Create a minimal project directory with source files."""
    (tmp_path / "main.py").write_text("import utils\nprint('hello')\n")
    (tmp_path / "utils.py").write_text("def helper(): pass\n")
    return str(tmp_path)


@pytest.fixture
def temp_project_with_c(tmp_path):
    """Create a minimal C project directory."""
    (tmp_path / "main.c").write_text('#include "utils.h"\nint main() { return 0; }\n')
    (tmp_path / "utils.h").write_text("#pragma once\nvoid helper();\n")
    (tmp_path / "utils.c").write_text('#include "utils.h"\nvoid helper() {}\n')
    return str(tmp_path)


# =========================================================================
# _validate_directory tests
# =========================================================================

class TestValidateDirectory:
    """Test path traversal hardening in _validate_directory."""

    def test_valid_subdirectory(self, tmp_path):
        """A real subdirectory of the allowed base should pass."""
        sub = tmp_path / "project"
        sub.mkdir()
        with patch.object(app_module, '_ALLOWED_BASE_DIR', str(tmp_path)):
            result = app_module._validate_directory(str(sub))
            assert result == os.path.realpath(str(sub))

    def test_base_dir_itself_valid(self, tmp_path):
        """The base directory itself should be valid."""
        with patch.object(app_module, '_ALLOWED_BASE_DIR', str(tmp_path)):
            result = app_module._validate_directory(str(tmp_path))
            assert result == os.path.realpath(str(tmp_path))

    def test_path_traversal_rejected(self, tmp_path):
        """Paths outside the allowed base should be rejected."""
        with patch.object(app_module, '_ALLOWED_BASE_DIR', str(tmp_path)):
            result = app_module._validate_directory("/etc")
            assert result is None

    def test_dotdot_traversal_rejected(self, tmp_path):
        """Paths with .. that escape the base should be rejected."""
        sub = tmp_path / "project"
        sub.mkdir()
        with patch.object(app_module, '_ALLOWED_BASE_DIR', str(sub)):
            result = app_module._validate_directory(str(sub / ".." / ".."))
            assert result is None

    def test_nonexistent_directory_rejected(self, tmp_path):
        """Non-existent directories should be rejected."""
        with patch.object(app_module, '_ALLOWED_BASE_DIR', str(tmp_path)):
            result = app_module._validate_directory(str(tmp_path / "does_not_exist"))
            assert result is None

    def test_symlink_escape_rejected(self, tmp_path):
        """Symlinks that escape the base directory should be rejected."""
        base = tmp_path / "safe"
        base.mkdir()
        # Create a symlink inside base that points outside
        link = base / "escape"
        try:
            link.symlink_to("/tmp")
        except OSError:
            pytest.skip("Cannot create symlinks on this platform")
        with patch.object(app_module, '_ALLOWED_BASE_DIR', str(base)):
            result = app_module._validate_directory(str(link))
            assert result is None

    def test_file_not_directory_rejected(self, tmp_path):
        """A file path (not a directory) should be rejected."""
        f = tmp_path / "file.txt"
        f.write_text("hello")
        with patch.object(app_module, '_ALLOWED_BASE_DIR', str(tmp_path)):
            result = app_module._validate_directory(str(f))
            assert result is None


# =========================================================================
# _safe_extract_zip tests
# =========================================================================

class TestSafeExtractZip:
    """Test ZIP extraction security."""

    def test_normal_zip_extraction(self, tmp_path):
        """A normal ZIP file should extract successfully."""
        zip_path = tmp_path / "test.zip"
        dest = tmp_path / "dest"
        dest.mkdir()

        with zipfile.ZipFile(str(zip_path), 'w') as zf:
            zf.writestr("hello.py", "print('hello')")
            zf.writestr("sub/world.py", "print('world')")

        app_module._safe_extract_zip(str(zip_path), str(dest))

        assert (dest / "hello.py").exists()
        assert (dest / "sub" / "world.py").exists()

    def test_zip_slip_rejected(self, tmp_path):
        """ZIP entries with path traversal should be rejected."""
        zip_path = tmp_path / "evil.zip"
        dest = tmp_path / "dest"
        dest.mkdir()

        with zipfile.ZipFile(str(zip_path), 'w') as zf:
            zf.writestr("../../escape.py", "print('hacked')")

        with pytest.raises(ValueError, match="escapes target"):
            app_module._safe_extract_zip(str(zip_path), str(dest))


# =========================================================================
# Rate limiter tests
# =========================================================================

class TestRateLimiter:
    """Test the rate limiting logic."""

    def test_under_limit_allowed(self):
        """Requests under the limit should be allowed."""
        app_module._rate_store.clear()
        with patch.object(app_module, '_RATE_LIMIT', 10):
            with patch.object(app_module, '_RATE_WINDOW', 60):
                with app_module.app.test_request_context():
                    result = app_module._rate_limit_check()
                    assert result is False

    def test_over_limit_rejected(self):
        """Requests over the limit should be rejected."""
        app_module._rate_store.clear()
        now = time.time()
        with patch.object(app_module, '_RATE_LIMIT', 3):
            with patch.object(app_module, '_RATE_WINDOW', 60):
                with app_module.app.test_request_context():
                    ip = app_module.request.remote_addr or 'unknown'
                    # Pre-fill with enough timestamps
                    app_module._rate_store[ip] = [now - 1, now - 0.5, now - 0.1]
                    result = app_module._rate_limit_check()
                    assert result is True

    def test_stale_entries_cleaned(self):
        """Old timestamps outside the window should be purged."""
        app_module._rate_store.clear()
        old_time = time.time() - 1000  # Way outside any window
        with patch.object(app_module, '_RATE_LIMIT', 5):
            with patch.object(app_module, '_RATE_WINDOW', 60):
                with app_module.app.test_request_context():
                    ip = app_module.request.remote_addr or 'unknown'
                    app_module._rate_store[ip] = [old_time, old_time + 1]
                    result = app_module._rate_limit_check()
                    assert result is False  # Old entries cleaned, under limit


# =========================================================================
# Upload session management tests
# =========================================================================

class TestUploadSessions:
    """Test upload session persistence and cleanup."""

    def test_save_and_load_session(self, tmp_path):
        """Saved sessions should be loadable."""
        token = "test_token_123"
        temp_dir = str(tmp_path / "project")
        os.makedirs(temp_dir, exist_ok=True)
        app_module._save_upload_session(token, temp_dir)

        loaded = app_module._load_upload_session(token)
        assert loaded == temp_dir

    def test_load_nonexistent_session(self):
        """Loading a non-existent session should return None."""
        result = app_module._load_upload_session("nonexistent_token_xyz_999")
        assert result is None

    def test_expired_session_returns_none(self, tmp_path):
        """Expired sessions should return None."""
        token = "expired_token_456"
        temp_dir = str(tmp_path / "old_project")
        os.makedirs(temp_dir, exist_ok=True)
        app_module._save_upload_session(token, temp_dir)

        # Manually set the session file mtime to the past
        session_file = app_module._session_file(token)
        old_time = time.time() - app_module._UPLOAD_TTL - 100
        os.utime(session_file, (old_time, old_time))

        result = app_module._load_upload_session(token)
        assert result is None

    def test_session_file_sanitizes_token(self):
        """Token should be sanitized to prevent path traversal."""
        dangerous_token = "../../etc/passwd"
        safe_path = app_module._session_file(dangerous_token)
        # Should not contain ..
        assert ".." not in os.path.basename(safe_path)


# =========================================================================
# _normalise_git_url tests
# =========================================================================

class TestNormaliseGitUrl:
    """Test git URL normalization (used by churn-remote)."""

    def test_owner_repo_shorthand(self):
        """owner/repo should resolve to GitHub HTTPS URL."""
        from churn import _normalise_git_url
        result = _normalise_git_url("user/project")
        assert result == "https://github.com/user/project.git"

    def test_github_https(self):
        """Full GitHub HTTPS URL should be normalized."""
        from churn import _normalise_git_url
        result = _normalise_git_url("https://github.com/user/project")
        assert result == "https://github.com/user/project.git"

    def test_github_https_with_dot_git(self):
        """GitHub URL already ending in .git should still work."""
        from churn import _normalise_git_url
        result = _normalise_git_url("https://github.com/user/project.git")
        assert result == "https://github.com/user/project.git"

    def test_gitlab_url(self):
        """GitLab URLs should be accepted."""
        from churn import _normalise_git_url
        result = _normalise_git_url("https://gitlab.com/user/project")
        assert result == "https://gitlab.com/user/project.git"

    def test_bitbucket_url(self):
        """Bitbucket URLs should be accepted."""
        from churn import _normalise_git_url
        result = _normalise_git_url("https://bitbucket.org/user/project")
        assert result == "https://bitbucket.org/user/project.git"

    def test_invalid_url_returns_none(self):
        """Invalid URLs should return None."""
        from churn import _normalise_git_url
        assert _normalise_git_url("ftp://example.com/repo") is None
        assert _normalise_git_url("not a url at all") is None
        assert _normalise_git_url("") is None

    def test_trailing_slash_stripped(self):
        """Trailing slashes should be handled."""
        from churn import _normalise_git_url
        result = _normalise_git_url("https://github.com/user/project/")
        assert result == "https://github.com/user/project.git"

    def test_http_to_https(self):
        """HTTP URLs should be accepted (pattern allows http)."""
        from churn import _normalise_git_url
        result = _normalise_git_url("http://github.com/user/project")
        assert result == "https://github.com/user/project.git"


# =========================================================================
# API route tests (requires Flask test client)
# =========================================================================

class TestApiConfig:
    """Test /api/config endpoint."""

    def test_config_returns_dev_mode(self, client):
        """Config endpoint should return dev_mode flag."""
        resp = client.get('/api/config')
        assert resp.status_code == 200
        data = resp.get_json()
        assert "dev_mode" in data
        assert isinstance(data["dev_mode"], bool)


class TestApiDetect:
    """Test /api/detect endpoint."""

    def test_detect_with_valid_dir(self, client, temp_project):
        """Detect endpoint should return language flags for a valid directory."""
        with patch.object(app_module, '_ALLOWED_BASE_DIR', os.path.dirname(temp_project)):
            resp = client.get(f'/api/detect?dir={temp_project}')
            assert resp.status_code == 200
            data = resp.get_json()
            assert "has_py" in data
            assert data["has_py"] is True

    def test_detect_with_invalid_dir(self, client):
        """Detect endpoint should return 400 for invalid directory."""
        with patch.object(app_module, '_ALLOWED_BASE_DIR', '/tmp/safe_base_for_test'):
            resp = client.get('/api/detect?dir=/etc/definitely_not_allowed')
            assert resp.status_code == 400


class TestApiGraph:
    """Test /api/graph endpoint."""

    def test_graph_with_valid_dir(self, client, temp_project):
        """Graph endpoint should return graph data."""
        with patch.object(app_module, '_ALLOWED_BASE_DIR', os.path.dirname(temp_project)):
            resp = client.get(f'/api/graph?dir={temp_project}&show_py=true&hide_system=true')
            assert resp.status_code == 200
            data = resp.get_json()
            assert "nodes" in data
            assert "edges" in data
            assert "has_cycles" in data

    def test_graph_with_invalid_dir(self, client):
        """Graph endpoint should return 400 for invalid directory."""
        with patch.object(app_module, '_ALLOWED_BASE_DIR', '/tmp/safe_base_for_test'):
            resp = client.get('/api/graph?dir=/etc/nope')
            assert resp.status_code == 400


class TestApiFile:
    """Test /api/file endpoint."""

    def test_get_file_valid(self, client, temp_project):
        """File endpoint should return file contents."""
        with patch.object(app_module, '_ALLOWED_BASE_DIR', os.path.dirname(temp_project)):
            resp = client.get(f'/api/file?dir={temp_project}&path=main.py')
            assert resp.status_code == 200
            data = resp.get_json()
            assert "content" in data
            assert "language" in data
            assert data["language"] == "python"

    def test_get_file_missing_path(self, client):
        """File endpoint should return 400 when no path is provided."""
        resp = client.get('/api/file?dir=.')
        assert resp.status_code == 400

    def test_get_file_path_traversal(self, client, temp_project):
        """File endpoint should reject path traversal attempts."""
        with patch.object(app_module, '_ALLOWED_BASE_DIR', os.path.dirname(temp_project)):
            resp = client.get(f'/api/file?dir={temp_project}&path=../../etc/passwd')
            assert resp.status_code == 403

    def test_get_file_not_found(self, client, temp_project):
        """File endpoint should return 404 for non-existent files."""
        with patch.object(app_module, '_ALLOWED_BASE_DIR', os.path.dirname(temp_project)):
            resp = client.get(f'/api/file?dir={temp_project}&path=nonexistent_file_xyz.py')
            assert resp.status_code == 404
