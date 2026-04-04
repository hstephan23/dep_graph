"""Unit tests for Kotlin, Scala, PHP, Dart, and Elixir resolver functions."""

import os
import pytest
from parsers import (
    resolve_kotlin_import,
    resolve_scala_import,
    build_php_namespace_map,
    resolve_php_use,
    resolve_php_require,
    resolve_dart_import,
    resolve_elixir_module,
)


# =============================================================================
# resolve_kotlin_import tests
# =============================================================================

class TestResolveKotlinImport:
    """Tests for resolve_kotlin_import()."""

    def test_stdlib_external(self):
        known_files = {'main.kt'}
        resolved, is_external = resolve_kotlin_import(
            'kotlin.collections.List', '.', known_files
        )
        assert is_external is True

    def test_java_stdlib_external(self):
        known_files = {'main.kt'}
        resolved, is_external = resolve_kotlin_import(
            'java.util.UUID', '.', known_files
        )
        assert is_external is True

    def test_android_external(self):
        known_files = {'main.kt'}
        resolved, is_external = resolve_kotlin_import(
            'android.os.Bundle', '.', known_files
        )
        assert is_external is True

    def test_local_import_resolves(self):
        known_files = {
            'main.kt',
            os.path.join('com', 'example', 'models', 'User.kt'),
        }
        resolved, is_external = resolve_kotlin_import(
            'com.example.models.User', '.', known_files
        )
        assert resolved == os.path.join('com', 'example', 'models', 'User.kt')
        assert is_external is False

    def test_wildcard_import(self):
        known_files = {
            'main.kt',
            os.path.join('com', 'example', 'models', 'User.kt'),
            os.path.join('com', 'example', 'models', 'Order.kt'),
        }
        resolved, is_external = resolve_kotlin_import(
            'com.example.models.*', '.', known_files
        )
        assert is_external is False

    def test_unresolved_external(self):
        known_files = {'main.kt'}
        resolved, is_external = resolve_kotlin_import(
            'com.unknown.Library', '.', known_files
        )
        assert is_external is True

    def test_parent_path_resolution(self):
        """When com/example/models/User.kt exists, importing
        com.example.models.User should resolve."""
        known_files = {
            os.path.join('com', 'example', 'models.kt'),
        }
        resolved, is_external = resolve_kotlin_import(
            'com.example.models.SomeClass', '.', known_files
        )
        assert resolved == os.path.join('com', 'example', 'models.kt')
        assert is_external is False


# =============================================================================
# resolve_scala_import tests
# =============================================================================

class TestResolveScalaImport:
    """Tests for resolve_scala_import()."""

    def test_stdlib_external(self):
        known_files = {'Main.scala'}
        resolved, is_external = resolve_scala_import(
            'scala.collection.mutable', '.', known_files
        )
        assert is_external is True

    def test_java_stdlib_external(self):
        known_files = {'Main.scala'}
        resolved, is_external = resolve_scala_import(
            'java.util.UUID', '.', known_files
        )
        assert is_external is True

    def test_local_import_resolves(self):
        known_files = {
            'Main.scala',
            os.path.join('com', 'example', 'models', 'User.scala'),
        }
        resolved, is_external = resolve_scala_import(
            'com.example.models.User', '.', known_files
        )
        assert resolved == os.path.join('com', 'example', 'models', 'User.scala')
        assert is_external is False

    def test_brace_import(self):
        known_files = {
            os.path.join('com', 'example', 'models.scala'),
        }
        resolved, is_external = resolve_scala_import(
            'com.example.models.{Foo, Bar}', '.', known_files
        )
        assert resolved == os.path.join('com', 'example', 'models.scala')
        assert is_external is False

    def test_wildcard_import(self):
        known_files = {
            os.path.join('com', 'example', 'models.scala'),
        }
        resolved, is_external = resolve_scala_import(
            'com.example.models._', '.', known_files
        )
        assert resolved == os.path.join('com', 'example', 'models.scala')
        assert is_external is False

    def test_unresolved_external(self):
        known_files = {'Main.scala'}
        resolved, is_external = resolve_scala_import(
            'com.unknown.Library', '.', known_files
        )
        assert is_external is True

    def test_parent_path_resolution(self):
        known_files = {
            os.path.join('com', 'example', 'models.scala'),
        }
        resolved, is_external = resolve_scala_import(
            'com.example.models.User', '.', known_files
        )
        assert resolved == os.path.join('com', 'example', 'models.scala')
        assert is_external is False


# =============================================================================
# PHP resolver tests
# =============================================================================

class TestBuildPhpNamespaceMap:
    """Tests for build_php_namespace_map()."""

    def test_basic_namespace_map(self, tmp_path):
        """Build a namespace map from PHP files."""
        models = tmp_path / "src" / "Models"
        models.mkdir(parents=True)
        user_php = models / "User.php"
        user_php.write_text(
            "<?php\nnamespace App\\Models;\n\nclass User {}\n"
        )

        known_files = {'src/Models/User.php'}
        ns_map, class_map = build_php_namespace_map(str(tmp_path), known_files)

        assert 'App\\Models' in ns_map
        assert 'src/Models/User.php' in ns_map['App\\Models']
        assert 'App\\Models\\User' in class_map
        assert class_map['App\\Models\\User'] == 'src/Models/User.php'

    def test_empty_directory(self, tmp_path):
        ns_map, class_map = build_php_namespace_map(str(tmp_path), set())
        assert ns_map == {}
        assert class_map == {}


class TestResolvePhpUse:
    """Tests for resolve_php_use()."""

    def test_system_prefix_external(self):
        known_files = {'index.php'}
        resolved, is_external = resolve_php_use(
            'Illuminate\\Http\\Request', '.', known_files
        )
        assert is_external is True

    def test_symfony_external(self):
        known_files = {'index.php'}
        resolved, is_external = resolve_php_use(
            'Symfony\\Component\\HttpFoundation\\Request', '.', known_files
        )
        assert is_external is True

    def test_resolve_via_class_map(self):
        known_files = {'src/Models/User.php'}
        ns_map = {'App\\Models': ['src/Models/User.php']}
        class_map = {'App\\Models\\User': 'src/Models/User.php'}

        resolved, is_external = resolve_php_use(
            'App\\Models\\User', '.', known_files,
            ns_map=ns_map, class_map=class_map
        )
        assert resolved == 'src/Models/User.php'
        assert is_external is False

    def test_resolve_via_namespace_map(self):
        known_files = {'src/Models/User.php', 'src/Models/Order.php'}
        ns_map = {'App\\Models': ['src/Models/Order.php', 'src/Models/User.php']}
        class_map = {}

        resolved, is_external = resolve_php_use(
            'App\\Models', '.', known_files, ns_map=ns_map, class_map=class_map
        )
        assert resolved == 'src/Models/Order.php'
        assert is_external is False

    def test_unresolved_external(self):
        known_files = {'index.php'}
        resolved, is_external = resolve_php_use(
            'Unknown\\Package', '.', known_files
        )
        assert is_external is True


class TestResolvePhpRequire:
    """Tests for resolve_php_require()."""

    def test_resolve_relative(self):
        known_files = {'src/Models/User.php', 'index.php'}
        resolved, is_external = resolve_php_require(
            'src/Models/User.php', 'index.php', '.', known_files
        )
        assert resolved == 'src/Models/User.php'
        assert is_external is False

    def test_resolve_from_root(self):
        known_files = {'config.php', 'src/app.php'}
        resolved, is_external = resolve_php_require(
            'config.php', 'src/app.php', '.', known_files
        )
        assert resolved == 'config.php'
        assert is_external is False


# =============================================================================
# resolve_dart_import tests
# =============================================================================

class TestResolveDartImport:
    """Tests for resolve_dart_import()."""

    def test_dart_core_external(self):
        known_files = {'lib/main.dart'}
        resolved, is_external = resolve_dart_import(
            'dart:async', 'lib/main.dart', '.', known_files
        )
        assert is_external is True

    def test_dart_io_external(self):
        known_files = {'lib/main.dart'}
        resolved, is_external = resolve_dart_import(
            'dart:io', 'lib/main.dart', '.', known_files
        )
        assert is_external is True

    def test_flutter_package_external(self):
        known_files = {'lib/main.dart'}
        resolved, is_external = resolve_dart_import(
            'package:flutter/material.dart', 'lib/main.dart', '.', known_files
        )
        assert is_external is True

    def test_relative_import_resolves(self):
        known_files = {
            'lib/main.dart',
            'lib/models/user.dart',
        }
        resolved, is_external = resolve_dart_import(
            'models/user.dart', 'lib/main.dart', '.', known_files
        )
        assert resolved == 'lib/models/user.dart'
        assert is_external is False

    def test_parent_relative_import(self):
        known_files = {
            'lib/models/user.dart',
            'lib/services/user_service.dart',
        }
        resolved, is_external = resolve_dart_import(
            '../models/user.dart', 'lib/services/user_service.dart', '.', known_files
        )
        assert resolved == 'lib/models/user.dart'
        assert is_external is False

    def test_package_local_resolves(self):
        known_files = {'lib/models/user.dart', 'lib/main.dart'}
        resolved, is_external = resolve_dart_import(
            'package:my_app/models/user.dart', 'lib/main.dart', '.', known_files
        )
        assert resolved == 'lib/models/user.dart'
        assert is_external is False

    def test_external_package(self):
        known_files = {'lib/main.dart'}
        resolved, is_external = resolve_dart_import(
            'package:http/http.dart', 'lib/main.dart', '.', known_files
        )
        assert is_external is True


# =============================================================================
# resolve_elixir_module tests
# =============================================================================

class TestResolveElixirModule:
    """Tests for resolve_elixir_module()."""

    def test_stdlib_external(self):
        known_files = {'lib/my_app.ex'}
        resolved, is_external = resolve_elixir_module(
            'GenServer', 'lib/my_app.ex', '.', known_files
        )
        assert is_external is True

    def test_logger_external(self):
        known_files = {'lib/my_app.ex'}
        resolved, is_external = resolve_elixir_module(
            'Logger', 'lib/my_app.ex', '.', known_files
        )
        assert is_external is True

    def test_ecto_external(self):
        known_files = {'lib/my_app.ex'}
        resolved, is_external = resolve_elixir_module(
            'Ecto', 'lib/my_app.ex', '.', known_files
        )
        assert is_external is True

    def test_local_module_resolves(self):
        known_files = {
            'lib/my_app.ex',
            os.path.join('lib', 'my_app', 'models', 'user.ex'),
        }
        resolved, is_external = resolve_elixir_module(
            'MyApp.Models.User', 'lib/my_app.ex', '.', known_files
        )
        assert resolved == os.path.join('lib', 'my_app', 'models', 'user.ex')
        assert is_external is False

    def test_camel_to_snake_conversion(self):
        """CamelCase module names should convert to snake_case paths."""
        known_files = {
            os.path.join('lib', 'my_app', 'services', 'user_service.ex'),
        }
        resolved, is_external = resolve_elixir_module(
            'MyApp.Services.UserService', 'lib/my_app.ex', '.', known_files
        )
        assert resolved == os.path.join('lib', 'my_app', 'services', 'user_service.ex')
        assert is_external is False

    def test_unresolved_external(self):
        known_files = {'lib/my_app.ex'}
        resolved, is_external = resolve_elixir_module(
            'SomeThirdParty.Client', 'lib/my_app.ex', '.', known_files
        )
        assert is_external is True

    def test_fallback_basename_match(self):
        """Should match by basename if full path doesn't match."""
        known_files = {'lib/user.ex'}
        resolved, is_external = resolve_elixir_module(
            'CustomApp.User', 'lib/my_app.ex', '.', known_files
        )
        assert resolved == 'lib/user.ex'
        assert is_external is False

    def test_exs_extension(self):
        """Should also resolve .exs files."""
        known_files = {
            os.path.join('lib', 'my_app', 'config.exs'),
        }
        resolved, is_external = resolve_elixir_module(
            'MyApp.Config', 'lib/my_app.ex', '.', known_files
        )
        assert resolved == os.path.join('lib', 'my_app', 'config.exs')
        assert is_external is False
