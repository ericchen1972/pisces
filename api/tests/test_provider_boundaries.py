import ast
import os
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).parents[2]
API_ROOT = REPOSITORY_ROOT / "api"
API_SOURCE = API_ROOT / "main.py"
OPENAI_SERVICE_SOURCE = API_ROOT / "openai_service.py"
SMOKE_SOURCE = API_ROOT / "test.py"
README_SOURCE = REPOSITORY_ROOT / "README.md"
WEB_SOURCE_ROOT = REPOSITORY_ROOT / "web" / "src"

ADAPTER_MODULE = "media_providers.py"
ADAPTER_PUBLIC_API = {"generate_gemini_image", "generate_lyria_music"}
ADAPTER_IMPORT_ALLOWLIST = {
    ("main.py", "generate_image_with_gemini", "generate_gemini_image"),
    ("main.py", "generate_music_with_lyria", "generate_lyria_music"),
}
PROVIDER_CALL_ALLOWLIST = {
    (ADAPTER_MODULE, "generate_lyria_music._run", "google.genai.Client"),
    (
        ADAPTER_MODULE,
        "generate_lyria_music._run",
        "google.genai.types.WeightedPrompt",
    ),
    (
        ADAPTER_MODULE,
        "generate_lyria_music._run",
        "google.genai.types.LiveMusicGenerationConfig",
    ),
}
RESERVED_PROVIDER_NAMES = {"genai", "genai_types"}
ADAPTER_PROVIDER_IMPORTS = {
    ("google", "genai", None),
    ("google.genai", "types", "genai_types"),
}
PROVIDER_MODULE_PREFIXES = (
    "google.genai",
    "google.generativeai",
    "google.cloud.speech",
)
FORBIDDEN_EXECUTABLE_PROVIDER_STRINGS = (
    "google.genai",
    "google.generativeai",
    "google.cloud.speech",
    "generativelanguage.googleapis.com",
    "speech.googleapis.com",
)
LEGACY_PROVIDER_HELPERS = {
    "generate_gemini_reply",
    "create_live_ephemeral_token",
    "pcm16_to_wav_bytes",
    "synthesize_music_wav_bytes_fallback",
}
EXCLUDED_API_DIRECTORIES = {
    "tests",
    "test",
    "__pycache__",
    ".venv",
    "venv",
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    "build",
    "dist",
    "node_modules",
}
FORBIDDEN_WEB_PROVIDER_TOKENS = {
    "generate_gemini_reply(",
    "Gemini Live",
    "SpeechClient(",
    "GoogleGenAI",
    "Modality",
    "google.cloud.speech",
    "@google/genai",
    "create_live_ephemeral_token(",
    "pcm16_to_wav_bytes(",
}


def _production_api_paths(api_root=API_ROOT):
    paths = []
    for directory, child_directories, filenames in os.walk(api_root):
        child_directories[:] = [
            name
            for name in child_directories
            if name not in EXCLUDED_API_DIRECTORIES
        ]
        paths.extend(
            Path(directory) / filename
            for filename in filenames
            if filename.endswith(".py")
        )
    return sorted(paths)


def _parents(tree):
    result = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            result[child] = parent
    return result


def _qualified_scope(node, parents):
    names = []
    current = node
    while current in parents:
        current = parents[current]
        if isinstance(current, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.append(current.name)
    return ".".join(reversed(names)) or "<module>"


def _root_name(node):
    while isinstance(node, ast.Attribute):
        node = node.value
    return node.id if isinstance(node, ast.Name) else ""


def _argument_names(arguments):
    names = {
        argument.arg
        for argument in (
            list(arguments.posonlyargs)
            + list(arguments.args)
            + list(arguments.kwonlyargs)
        )
    }
    if arguments.vararg:
        names.add(arguments.vararg.arg)
    if arguments.kwarg:
        names.add(arguments.kwarg.arg)
    return names


def _qualified_symbol(node, provider_aliases):
    if isinstance(node, ast.Name):
        return provider_aliases.get(node.id, node.id)
    if isinstance(node, ast.Attribute):
        prefix = _qualified_symbol(node.value, provider_aliases)
        return f"{prefix}.{node.attr}" if prefix else node.attr
    return ""


def _is_provider_symbol(canonical):
    return canonical.startswith(
        PROVIDER_MODULE_PREFIXES + ("genai.", "genai_types.")
    ) or canonical.rsplit(".", 1)[-1] in {
        "GoogleGenAI",
        "Modality",
        "SpeechClient",
    }


def _binding_names(node):
    type_parameter_names = {
        name
        for type_parameter in getattr(node, "type_params", ())
        if (name := getattr(type_parameter, "name", None))
    }
    if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
        return {node.id}
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
        names = _argument_names(node.args)
        if not isinstance(node, ast.Lambda):
            names.add(node.name)
        return names | type_parameter_names
    if isinstance(node, ast.ClassDef):
        return {node.name} | type_parameter_names
    if type_parameter_names:
        return type_parameter_names
    if isinstance(node, ast.Import):
        return {
            imported.asname or imported.name.split(".", 1)[0]
            for imported in node.names
        }
    if isinstance(node, ast.ImportFrom):
        return {imported.asname or imported.name for imported in node.names}
    if isinstance(node, ast.ExceptHandler):
        return {node.name} if node.name else set()
    if isinstance(node, (ast.MatchAs, ast.MatchStar)):
        return {node.name} if node.name else set()
    if isinstance(node, ast.MatchMapping):
        return {node.rest} if node.rest else set()
    if isinstance(node, (ast.Global, ast.Nonlocal)):
        return set(node.names)
    return set()


def _structural_provider_violations(source, label):
    tree = ast.parse(source, filename=label)
    parents = _parents(tree)
    violations = []
    provider_aliases = {}
    approved_provider_bindings = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for imported in node.names:
                canonical = imported.name
                bound_name = imported.asname or canonical.split(".", 1)[0]
                if canonical.startswith(PROVIDER_MODULE_PREFIXES):
                    provider_aliases[bound_name] = canonical if imported.asname else bound_name
                    violations.append(
                        (label, node.lineno, canonical, "provider import outside adapter")
                    )
                if canonical == "media_providers" or canonical.endswith(
                    ".media_providers"
                ):
                    violations.append(
                        (label, node.lineno, canonical, "adapter module import is not allowed")
                    )
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if any(imported.name == "*" for imported in node.names):
                violations.append(
                    (label, node.lineno, module, "star import is forbidden")
                )
            if module == "google" or module.startswith(
                ("google.genai", "google.generativeai")
            ):
                for imported in node.names:
                    canonical = f"{module}.{imported.name}"
                    bound_name = imported.asname or imported.name
                    if canonical.startswith(
                        ("google.genai", "google.generativeai")
                    ):
                        provider_aliases[bound_name] = canonical
                        if (
                            label != ADAPTER_MODULE
                            or canonical.startswith("google.generativeai")
                            or (
                                module,
                                imported.name,
                                imported.asname,
                            )
                            not in ADAPTER_PROVIDER_IMPORTS
                            or not isinstance(parents.get(node), ast.Module)
                        ):
                            violations.append(
                                (
                                    label,
                                    node.lineno,
                                    canonical,
                                    "provider import outside adapter",
                                )
                            )
                        else:
                            approved_provider_bindings.add((node, bound_name))
                    if imported.name in {"GoogleGenAI", "Modality", "SpeechClient"}:
                        violations.append(
                            (label, node.lineno, canonical, "legacy provider symbol")
                        )
            if module.startswith("google.cloud.speech") or (
                module == "google.cloud"
                and any(imported.name == "speech" for imported in node.names)
            ):
                violations.append(
                    (label, node.lineno, module, "Google Speech import")
                )
            if module == "media_providers" or module.endswith(".media_providers"):
                scope = _qualified_scope(node, parents)
                for imported in node.names:
                    key = (label, scope, imported.name)
                    if (
                        key not in ADAPTER_IMPORT_ALLOWLIST
                        or imported.asname is not None
                    ):
                        violations.append(
                            (label, node.lineno, imported.name, "adapter import outside facade")
                        )

    for node in ast.walk(tree):
        if label == ADAPTER_MODULE:
            for name in _binding_names(node) & RESERVED_PROVIDER_NAMES:
                if (node, name) not in approved_provider_bindings:
                    violations.append(
                        (label, node.lineno, name, "reserved provider name rebound")
                    )

        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name in LEGACY_PROVIDER_HELPERS:
                violations.append((label, node.lineno, node.name, "legacy helper"))
            if (
                label == ADAPTER_MODULE
                and isinstance(parents.get(node), ast.Module)
                and not node.name.startswith("_")
                and node.name not in ADAPTER_PUBLIC_API
            ):
                violations.append(
                    (label, node.lineno, node.name, "unexpected public adapter helper")
                )
        elif isinstance(node, ast.ClassDef):
            if (
                label == ADAPTER_MODULE
                and isinstance(parents.get(node), ast.Module)
                and not node.name.startswith("_")
            ):
                violations.append(
                    (label, node.lineno, node.name, "unexpected public adapter class")
                )

        if isinstance(node, (ast.Attribute, ast.Name)) and not (
            isinstance(parents.get(node), ast.Attribute)
            and parents[node].value is node
        ):
            canonical = _qualified_symbol(node, provider_aliases)
            if _is_provider_symbol(canonical):
                parent = parents.get(node)
                is_direct_call = isinstance(parent, ast.Call) and parent.func is node
                scope = _qualified_scope(node, parents)
                if (
                    label != ADAPTER_MODULE
                    or not is_direct_call
                    or (label, scope, canonical) not in PROVIDER_CALL_ALLOWLIST
                ):
                    violations.append(
                        (
                            label,
                            node.lineno,
                            canonical,
                            "provider symbol must be an allowed direct call target",
                        )
                    )

    docstrings = {
        body[0].value
        for owner in ast.walk(tree)
        if isinstance(
            owner, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
        )
        and (body := getattr(owner, "body", []))
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and isinstance(body[0].value.value, str)
    }
    for node in ast.walk(tree):
        if (
            not isinstance(node, ast.Constant)
            or not isinstance(node.value, str)
            or node in docstrings
            or not any(
                token in node.value for token in FORBIDDEN_EXECUTABLE_PROVIDER_STRINGS
            )
        ):
            continue
        expression = node
        if isinstance(parents.get(expression), ast.JoinedStr):
            expression = parents[expression]
        assignment = parents.get(expression)
        allowed_http_literal = (
            label == ADAPTER_MODULE
            and _qualified_scope(node, parents) == "_call_generate_content"
            and node.value
            == "https://generativelanguage.googleapis.com/v1beta/models/"
            and isinstance(assignment, ast.Assign)
            and assignment.value is expression
            and len(assignment.targets) == 1
            and isinstance(assignment.targets[0], ast.Name)
            and assignment.targets[0].id == "endpoint"
        )
        if not allowed_http_literal:
            violations.append(
                (label, node.lineno, node.value, "executable provider string")
            )

    if label == ADAPTER_MODULE:
        exports = []
        for node in tree.body:
            if (
                isinstance(node, ast.Assign)
                and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)
                and node.targets[0].id == "__all__"
            ):
                try:
                    exports = ast.literal_eval(node.value)
                except (ValueError, TypeError):
                    exports = []
        if set(exports) != ADAPTER_PUBLIC_API:
            violations.append((label, 1, "__all__", "adapter exports must match named API"))
    return violations


def _production_api_violations(api_root=API_ROOT):
    violations = []
    for path in _production_api_paths(api_root):
        violations.extend(
            _structural_provider_violations(
                path.read_text(encoding="utf-8"),
                str(path.relative_to(api_root)),
            )
        )
    return violations


def test_structural_scanner_rejects_provider_symbol_alias_shapes():
    mutations = {
        "forward global": "factory = genai.Client",
        "annotated alias": "factory: object = genai.Client",
        "conditional alias": "\nif enabled:\n    factory = genai.Client",
        "attribute alias": "\nself.factory = genai.Client",
        "walrus alias": "\nif factory := genai.Client:\n    pass",
        "closure late binding": (
            "\ndef outer():\n"
            "    def inner():\n"
            "        return factory()\n"
            "    factory = genai.Client\n"
        ),
    }
    for name, mutation in mutations.items():
        source = (
            "from google import genai\n"
            "__all__ = ['generate_gemini_image', 'generate_lyria_music']\n"
            + mutation
        )
        assert _structural_provider_violations(source, ADAPTER_MODULE), name


def test_structural_scanner_rejects_provider_global_from_class_method():
    source = """
from google import genai
__all__ = ['generate_gemini_image', 'generate_lyria_music']
class ProviderFactory:
    def make(self):
        return genai.Client(api_key='secret')
"""
    assert _structural_provider_violations(source, ADAPTER_MODULE)


def test_structural_scanner_accepts_non_reserved_fake_provider_name():
    source = """
from google import genai
__all__ = ['generate_gemini_image', 'generate_lyria_music']
def generate_gemini_image():
    fake_provider = FakeProvider()
    return fake_provider.Client()
def generate_lyria_music():
    return b'music'
"""
    assert _structural_provider_violations(source, ADAPTER_MODULE) == []


def test_structural_scanner_enforces_adapter_import_scope():
    approved = """
def generate_image_with_gemini(prompt):
    from media_providers import generate_gemini_image
    return generate_gemini_image('key', prompt)
"""
    forbidden = """
from media_providers import generate_gemini_image
def chat(prompt):
    return generate_gemini_image('key', prompt)
"""
    assert _structural_provider_violations(approved, "main.py") == []
    assert _structural_provider_violations(forbidden, "main.py")

    wrong_provider_alias = """
from google import genai as provider
from google.genai import types as provider_types
__all__ = ['generate_gemini_image', 'generate_lyria_music']
"""
    assert _structural_provider_violations(wrong_provider_alias, ADAPTER_MODULE)

    nested_provider_import = """
__all__ = ['generate_gemini_image', 'generate_lyria_music']
def _helper():
    from google import genai
    return None
"""
    assert _structural_provider_violations(nested_provider_import, ADAPTER_MODULE)


def test_structural_scanner_rejects_star_imports_in_production_modules():
    source = """
from helpers import *
__all__ = ['generate_gemini_image', 'generate_lyria_music']
"""
    assert _structural_provider_violations(source, ADAPTER_MODULE)
    assert _structural_provider_violations(source, "features/chat.py")


def test_structural_scanner_rejects_unimported_provider_name_outside_adapter():
    source = """
def chat():
    return genai.Client(api_key='secret')
"""
    assert _structural_provider_violations(source, "features/chat.py")


def test_structural_scanner_rejects_provider_symbol_return_and_argument():
    returned = """
from google import genai
__all__ = ['generate_gemini_image', 'generate_lyria_music']
def generate_gemini_image(api_key, prompt):
    return b'image', 'image/png'
def generate_lyria_music(api_key, prompt):
    return b'music'
def _factory():
    return genai.Client
"""
    argument = """
from google.genai import Client
__all__ = ['generate_gemini_image', 'generate_lyria_music']
def generate_gemini_image(api_key, prompt):
    consume(Client)
    return b'image', 'image/png'
def generate_lyria_music(api_key, prompt):
    return b'music'
"""
    assert _structural_provider_violations(returned, ADAPTER_MODULE)
    assert _structural_provider_violations(argument, ADAPTER_MODULE)


def test_structural_scanner_rejects_legacy_provider_import():
    source = """
import google.generativeai as legacy_genai
def chat():
    return legacy_genai.GenerativeModel('legacy')
"""
    assert _structural_provider_violations(source, "features/chat.py")


def test_structural_scanner_rejects_direct_provider_http_and_dynamic_import_strings():
    direct_http = """
PROVIDER_URL = 'https://generativelanguage.googleapis.com/v1beta/models/example'
"""
    dynamic_import = """
import importlib
provider = importlib.import_module('google.genai')
"""
    assert _structural_provider_violations(direct_http, "features/chat.py")
    assert _structural_provider_violations(dynamic_import, "features/chat.py")

    adapter_dynamic_import = """
import importlib
__all__ = ['generate_gemini_image', 'generate_lyria_music']
provider = importlib.import_module('google.genai')
"""
    assert _structural_provider_violations(adapter_dynamic_import, ADAPTER_MODULE)


def test_adapter_allows_only_exact_generate_content_http_literal_position():
    approved = """
__all__ = ['generate_gemini_image', 'generate_lyria_music']
def _call_generate_content(model):
    endpoint = (
        'https://generativelanguage.googleapis.com/v1beta/models/'
        f'{model}:generateContent'
    )
    return endpoint
"""
    wrong_scope = approved.replace(
        "def _call_generate_content(model):", "def _other_helper(model):"
    )
    wrong_position = approved.replace("endpoint = (", "message = (")
    assert _structural_provider_violations(approved, ADAPTER_MODULE) == []
    assert _structural_provider_violations(wrong_scope, ADAPTER_MODULE)
    assert _structural_provider_violations(wrong_position, ADAPTER_MODULE)


def test_adapter_reserved_provider_names_cannot_be_rebound():
    mutations = {
        "assignment": "genai = FakeProvider()",
        "parameter": "def _helper(genai):\n    return None",
        "lambda parameter": "value = (lambda genai: None)(object())",
        "comprehension": "value = [None for genai in ()]",
        "multi-generator": "value = [None for x in () for genai_types in ()]",
        "except handler": (
            "try:\n    work()\nexcept Exception as genai:\n    pass"
        ),
        "match as": "match value:\n    case genai:\n        pass",
        "match star": "match value:\n    case [*genai_types]:\n        pass",
        "match mapping rest": (
            "match value:\n    case {'provider': item, **genai}:\n        pass"
        ),
        "global": "def _helper():\n    global genai\n    return None",
        "nonlocal": (
            "def _outer():\n"
            "    genai = None\n"
            "    def _inner():\n"
            "        nonlocal genai\n"
            "        return None\n"
        ),
    }
    prefix = (
        "from google import genai\n"
        "from google.genai import types as genai_types\n"
        "__all__ = ['generate_gemini_image', 'generate_lyria_music']\n"
    )
    for name, mutation in mutations.items():
        assert _structural_provider_violations(
            prefix + mutation, ADAPTER_MODULE
        ), name


def test_adapter_reserved_provider_names_include_pep695_type_parameters():
    if "type_params" not in ast.FunctionDef._fields:
        return
    mutations = (
        "def _helper[genai]():\n    return None",
        "async def _helper[genai_types]():\n    return None",
        "class _Helper[genai]:\n    pass",
        "def _helper[*genai_types]():\n    return None",
        "def _helper[**genai]():\n    return None",
    )
    prefix = "__all__ = ['generate_gemini_image', 'generate_lyria_music']\n"
    for mutation in mutations:
        assert _structural_provider_violations(
            prefix + mutation, ADAPTER_MODULE
        ), mutation


def test_adapter_reserved_provider_names_include_type_alias_parameters():
    type_alias = getattr(ast, "TypeAlias", None)
    if type_alias is None or "type_params" not in type_alias._fields:
        return
    prefix = "__all__ = ['generate_gemini_image', 'generate_lyria_music']\n"
    for name in RESERVED_PROVIDER_NAMES:
        source = prefix + f"type Alias[{name}] = int\n"
        assert _structural_provider_violations(source, ADAPTER_MODULE), name

    non_reserved = prefix + "type Alias[Item] = int\n"
    assert _structural_provider_violations(non_reserved, ADAPTER_MODULE) == []


def test_structural_scanner_accepts_exact_lyria_provider_call_scope():
    source = """
from google import genai
from google.genai import types as genai_types
__all__ = ['generate_gemini_image', 'generate_lyria_music']
def generate_gemini_image(api_key, prompt):
    return b'image', 'image/png'
def generate_lyria_music(api_key, prompt):
    async def _run():
        client = genai.Client(api_key=api_key)
        item = genai_types.WeightedPrompt(text=prompt, weight=1.0)
        config = genai_types.LiveMusicGenerationConfig(bpm=120)
        return client, item, config
    return _run
"""
    assert _structural_provider_violations(source, ADAPTER_MODULE) == []

    unknown_constructor = source.replace(
        "genai_types.LiveMusicGenerationConfig", "genai_types.UnknownConfig"
    )
    assert _structural_provider_violations(unknown_constructor, ADAPTER_MODULE)


def test_structural_scanner_rejects_public_adapter_helper_export():
    source = """
from google import genai
__all__ = ['generate_gemini_image', 'generate_lyria_music']
def generate_gemini_image(api_key, prompt):
    return b'image', 'image/png'
def generate_lyria_music(api_key, prompt):
    return b'music'
def provider_factory():
    return genai.Client
"""
    violations = _structural_provider_violations(source, ADAPTER_MODULE)
    assert any(
        violation[3] == "unexpected public adapter helper"
        for violation in violations
    )


def test_production_api_discovery_scans_cache_generated_and_testimony(tmp_path):
    api_root = tmp_path / "api"
    expected = []
    for directory_name in ("cache", "generated", "testimony"):
        directory = api_root / directory_name
        directory.mkdir(parents=True)
        module = directory / "provider.py"
        module.write_text("VALUE = 1\n", encoding="utf-8")
        expected.append(module)
    excluded = []
    for directory_name in ("tests", "test", "__pycache__", ".venv", "venv"):
        directory = api_root / directory_name
        directory.mkdir(parents=True)
        module = directory / "ignored.py"
        module.write_text("invalid Python by design", encoding="utf-8")
        excluded.append(module)

    discovered = _production_api_paths(api_root)
    assert all(module in discovered for module in expected)
    assert all(module not in discovered for module in excluded)


def test_all_production_api_modules_obey_structural_provider_boundary():
    assert _production_api_violations() == []


def _production_web_sources():
    paths = [
        REPOSITORY_ROOT / "web" / "package.json",
        REPOSITORY_ROOT / "web" / "index.html",
    ]
    paths.extend(
        path
        for path in WEB_SOURCE_ROOT.rglob("*")
        if path.suffix in {".js", ".jsx"}
        and ".test." not in path.name
        and "test" not in path.relative_to(WEB_SOURCE_ROOT).parts
    )
    return [
        (str(path.relative_to(REPOSITORY_ROOT)), path.read_text(encoding="utf-8"))
        for path in paths
    ]


def test_production_web_sources_contain_no_forbidden_provider_tokens():
    matches = [
        (label, token)
        for label, source in _production_web_sources()
        for token in FORBIDDEN_WEB_PROVIDER_TOKENS
        if token in source
    ]
    assert matches == []


def test_smoke_script_imports_flask_app_and_checks_readiness():
    tree = ast.parse(SMOKE_SOURCE.read_text(encoding="utf-8"))
    assert any(
        isinstance(node, ast.ImportFrom)
        and node.module == "main"
        and any(alias.name == "app" for alias in node.names)
        for node in tree.body
    )
    assert any(
        isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == "check_readiness"
        for node in tree.body
    )
    assert "Convia" in SMOKE_SOURCE.read_text(encoding="utf-8")


def test_readme_documents_provider_and_verification_contracts():
    readme = README_SOURCE.read_text(encoding="utf-8")
    required = {
        "# Convia",
        "OPENAI_KEY",
        "OPENAI_API_KEY",
        "OPENAI_TEXT_MODEL",
        "OPENAI_ROUTER_MODEL",
        "OPENAI_REALTIME_MODEL",
        "OPENAI_TRANSCRIBE_MODEL",
        "OPENAI_TTS_MODEL",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-realtime-2.1",
        "gpt-4o-mini-transcribe",
        "gpt-4o-mini-tts",
        "pytest -q",
        "npm test",
        "https://pisces-plum.vercel.app/",
        "https://pisces-315346868518.asia-east1.run.app",
    }
    assert all(token in readme for token in required)


def test_backend_has_no_legacy_user_facing_pisces_literals():
    literals = []
    for path in (API_SOURCE, OPENAI_SERVICE_SOURCE):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        literals.extend(
            node.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and "Pisces" in node.value
        )
    assert literals == []
