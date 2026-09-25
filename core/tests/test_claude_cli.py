import asyncio
import json
import subprocess

import pytest
from pydantic import BaseModel

from guionaria_core.services.llm import claude_cli
from guionaria_core.services.llm.claude_cli import (
    ClaudeCli,
    ClaudeError,
    generate_structured,
    parse_output,
)


def ok_output(**extra):
    base = {"type": "result", "subtype": "success", "is_error": False, "result": ""}
    return json.dumps(base | extra).encode()


# --- parse_output ---


def test_parse_prefers_structured_output():
    out = ok_output(structured_output={"a": 1}, result='{"a": 2}')
    assert parse_output(out, b"", 0) == {"a": 1}


def test_parse_falls_back_to_result_json():
    assert parse_output(ok_output(result='{"a": 2}'), b"", 0) == {"a": 2}


def test_parse_result_not_json():
    with pytest.raises(ClaudeError, match="formato JSON"):
        parse_output(ok_output(result="hola"), b"", 0)


def test_parse_is_error_limit_message():
    out = json.dumps({"is_error": True, "subtype": "success", "result": "Usage limit reached"})
    with pytest.raises(ClaudeError, match="límite de uso"):
        parse_output(out.encode(), b"", 1)


def test_parse_not_logged_in_on_stderr():
    with pytest.raises(ClaudeError, match="sesión iniciada"):
        parse_output(b"", b"Invalid API key. Please run /login", 1)


def test_parse_other_subtype_is_error():
    out = json.dumps({"is_error": False, "subtype": "error_max_turns", "result": None})
    with pytest.raises(ClaudeError, match="error_max_turns"):
        parse_output(out.encode(), b"", 1)


# --- ClaudeCli.run ---


def test_build_args_disables_tools_and_sessions():
    args = ClaudeCli(model="sonnet").build_args("claude", {"type": "object"})
    assert args[:2] == ["claude", "-p"]
    assert args[args.index("--tools") + 1] == ""
    assert "--no-session-persistence" in args
    assert args[args.index("--model") + 1] == "sonnet"
    assert json.loads(args[args.index("--json-schema") + 1]) == {"type": "object"}
    assert "--model" not in ClaudeCli().build_args("claude", {})


def test_run_sends_prompt_by_stdin(monkeypatch, tmp_path):
    captured = {}

    def fake_run(args, **kwargs):
        captured.update(kwargs, args=args)
        return subprocess.CompletedProcess(args, 0, ok_output(structured_output={"x": "y"}), b"")

    monkeypatch.setattr(claude_cli.shutil, "which", lambda _: "C:/claude.exe")
    monkeypatch.setattr(claude_cli.subprocess, "run", fake_run)
    result = asyncio.run(ClaudeCli().run("prompt con ñ", {"type": "object"}, cwd=tmp_path))
    assert result == {"x": "y"}
    assert captured["input"] == "prompt con ñ".encode()
    assert captured["cwd"] == str(tmp_path)
    assert "prompt con ñ" not in captured["args"]


def test_run_without_cli_installed(monkeypatch):
    monkeypatch.setattr(claude_cli.shutil, "which", lambda _: None)
    with pytest.raises(ClaudeError, match="No se encontró Claude Code"):
        asyncio.run(ClaudeCli().run("p", {}))


def test_run_timeout(monkeypatch):
    def fake_run(args, **kwargs):
        raise subprocess.TimeoutExpired(args, kwargs["timeout"])

    monkeypatch.setattr(claude_cli.shutil, "which", lambda _: "claude")
    monkeypatch.setattr(claude_cli.subprocess, "run", fake_run)
    with pytest.raises(ClaudeError, match="no respondió"):
        asyncio.run(ClaudeCli(timeout_s=120).run("p", {}))


def test_default_runner_uses_model_from_settings(home):
    from guionaria_core.config import AppSettings, save_settings

    save_settings(AppSettings(claude_model="opus"))
    runner = claude_cli._default_runner()
    assert isinstance(runner, ClaudeCli)
    assert runner.model == "opus"


# --- generate_structured ---


class Answer(BaseModel):
    texto: str


class ListRunner:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.prompts = []

    async def run(self, prompt, schema, cwd=None):
        self.prompts.append(prompt)
        return self.responses.pop(0)


def test_generate_structured_valid_first_try():
    runner = ListRunner({"texto": "hola"})
    assert asyncio.run(generate_structured(runner, "p", Answer)).texto == "hola"
    assert len(runner.prompts) == 1


def test_generate_structured_retries_with_error():
    runner = ListRunner({"otro": 1}, {"texto": "ok"})
    assert asyncio.run(generate_structured(runner, "p", Answer)).texto == "ok"
    assert "no fue válida" in runner.prompts[1]


def test_generate_structured_gives_up_after_two():
    runner = ListRunner({}, {})
    with pytest.raises(ClaudeError, match="dos veces"):
        asyncio.run(generate_structured(runner, "p", Answer))


def test_generate_structured_custom_check():
    def check(value):
        if value.texto == "malo":
            raise ValueError("texto prohibido")

    runner = ListRunner({"texto": "malo"}, {"texto": "bueno"})
    assert asyncio.run(generate_structured(runner, "p", Answer, check=check)).texto == "bueno"
    assert "texto prohibido" in runner.prompts[1]
