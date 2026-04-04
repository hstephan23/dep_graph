"""Shared fixtures for the DepGraph test suite."""

import os
import sys
import pytest

# Ensure the project root is on sys.path so `import parsers` and `import graph` work.
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))


@pytest.fixture
def fixtures_dir():
    """Return the absolute path to the tests/ directory."""
    return TESTS_DIR


@pytest.fixture
def test_files_dir(fixtures_dir):
    return os.path.join(fixtures_dir, "test_files")


@pytest.fixture
def test_cycle_dir(fixtures_dir):
    return os.path.join(fixtures_dir, "test_cycle")


@pytest.fixture
def test_py_dir(fixtures_dir):
    return os.path.join(fixtures_dir, "test_py")


@pytest.fixture
def test_js_dir(fixtures_dir):
    return os.path.join(fixtures_dir, "test_js")


@pytest.fixture
def test_java_dir(fixtures_dir):
    return os.path.join(fixtures_dir, "test_java")


@pytest.fixture
def test_go_dir(fixtures_dir):
    return os.path.join(fixtures_dir, "test_go")


@pytest.fixture
def test_rust_dir(fixtures_dir):
    return os.path.join(fixtures_dir, "test_rust")


@pytest.fixture
def test_csharp_dir(fixtures_dir):
    return os.path.join(fixtures_dir, "test_csharp")


@pytest.fixture
def test_cs_hyphen_dir(fixtures_dir):
    return os.path.join(fixtures_dir, "test_cs_hyphen")


@pytest.fixture
def test_swift_dir(fixtures_dir):
    return os.path.join(fixtures_dir, "test_swift")


@pytest.fixture
def test_ruby_dir(fixtures_dir):
    return os.path.join(fixtures_dir, "test_ruby")


@pytest.fixture
def test_dir_dir(fixtures_dir):
    return os.path.join(fixtures_dir, "test_dir")
