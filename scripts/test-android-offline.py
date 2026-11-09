#!/usr/bin/env python3
"""Real Android UI smoke for Consta's local mode, using only adb and stdlib.

Run against a dedicated fresh emulator after installing the release APK:
    python3 scripts/test-android-offline.py --serial emulator-5554

The script disables the emulator's network, creates a profile through the actual
UI, records an autodeclared manual sport, checks one local point, force-stops and
reopens the app, and checks persistence. It does not test GPS, photo selection,
physical sensors, background recording, accessibility or measured performance.
No data is seeded through application APIs or SQLite. Existing app data is never
cleared unless --reset-data is explicitly passed on a dedicated test emulator.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import traceback
from pathlib import Path
import xml.etree.ElementTree as ET

PACKAGE = "app.consta.mobile"
PROFILE_NAME = "TesteOffline"
FORBIDDEN = (
    "Entrar com Google", "Entrar com Apple", "Configuração externa pendente",
    "Configure o endereço HTTPS", "GOOGLE_CONFIGURATION_REQUIRED",
)


def normalized(value: str) -> str:
    return " ".join(value.split())


def node_labels(node: ET.Element) -> list[str]:
    return [normalized(node.get(key, "")) for key in ("text", "content-desc") if node.get(key)]


def bounds(node: ET.Element) -> tuple[int, int, int, int] | None:
    match = re.fullmatch(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", node.get("bounds", ""))
    return tuple(map(int, match.groups())) if match else None


class Smoke:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.deadline = time.monotonic() + args.timeout
        self.output = Path(args.output)
        self.output.mkdir(parents=True, exist_ok=True)
        self.adb = [args.adb] + (["-s", args.serial] if args.serial else [])
        self.stage = "initializing"
        self.last_xml = ""
        self.width, self.height = 1080, 1920
        self.checks: list[str] = []

    def remaining(self) -> float:
        value = self.deadline - time.monotonic()
        if value <= 0:
            raise TimeoutError(f"Tempo máximo excedido na etapa {self.stage}")
        return value

    def command(self, *arguments: str, timeout: float = 25, check: bool = True, binary: bool = False):
        result = subprocess.run(
            self.adb + list(arguments), capture_output=True,
            timeout=max(.1, min(timeout, self.remaining())),
        )
        if check and result.returncode:
            error = result.stderr.decode("utf-8", errors="replace")[-2500:]
            raise RuntimeError(f"adb {' '.join(arguments)} falhou ({result.returncode}): {error}")
        if binary:
            return result.stdout
        return (result.stdout + result.stderr).decode("utf-8", errors="replace")

    def shell(self, *arguments: str, **kwargs):
        return self.command("shell", *arguments, **kwargs)

    def announce(self, stage: str):
        self.stage = stage
        print(f"[offline-ui] {stage}", flush=True)

    def snapshot(self) -> ET.Element:
        error: Exception | None = None
        for _ in range(3):
            try:
                dump = self.shell("uiautomator", "dump", "--compressed", "/sdcard/consta-offline-smoke.xml", timeout=18)
                if "ERROR:" in dump:
                    raise RuntimeError(dump[-1200:])
                xml = self.command("exec-out", "cat", "/sdcard/consta-offline-smoke.xml", timeout=8)
                start = xml.find("<?xml")
                if start < 0:
                    start = xml.find("<hierarchy")
                if start < 0:
                    raise RuntimeError("A hierarquia nativa ainda não está disponível")
                xml = xml[start:].strip()
                root = ET.fromstring(xml)
                self.last_xml = xml
                (self.output / "last-ui.xml").write_text(xml, encoding="utf-8")
                return root
            except (RuntimeError, ET.ParseError, subprocess.TimeoutExpired) as exc:
                error = exc
                time.sleep(.4)
        raise RuntimeError(f"Não foi possível ler a UI nativa: {error}")

    def visible(self, node: ET.Element) -> bool:
        box = bounds(node)
        return bool(box and box[2] > box[0] and box[3] > box[1]
                    and box[0] < self.width and box[2] > 0
                    and box[1] < self.height and box[3] > 0
                    and node.get("enabled", "true") == "true")

    def matches(self, root: ET.Element, text: str) -> list[ET.Element]:
        return [n for n in root.iter("node") if self.visible(n) and normalized(text) in node_labels(n)]

    def tap_node(self, node: ET.Element):
        box = bounds(node)
        if not box:
            raise AssertionError("Elemento encontrado sem limites válidos")
        x = min(self.width - 2, max(1, (box[0] + box[2]) // 2))
        y = min(self.height - 2, max(1, (box[1] + box[3]) // 2))
        self.shell("input", "tap", str(x), str(y))
        time.sleep(.35)

    def swipe(self, upward: bool = True):
        start, end = (.78, .28) if upward else (.28, .78)
        self.shell("input", "swipe", str(self.width // 2), str(int(self.height * start)),
                   str(self.width // 2), str(int(self.height * end)), "360")
        time.sleep(.25)

    def find(self, text: str, *, timeout: float = 35, scroll: bool = False) -> ET.Element:
        end = min(self.deadline, time.monotonic() + timeout)
        last = ""
        identical = 0
        swipes = 0
        reversed_once = False
        while time.monotonic() < end:
            root = self.snapshot()
            candidates = self.matches(root, text)
            if candidates:
                return max(candidates, key=lambda n: (n.get("clickable") == "true", n.get("focusable") == "true"))
            if scroll:
                current = ET.tostring(root, encoding="unicode")
                identical = identical + 1 if current == last else 0
                last = current
                if identical >= 2 and not reversed_once:
                    # Some screen transitions preserve an old scroll offset.
                    for _ in range(5):
                        self.swipe(False)
                    reversed_once = True
                    identical = 0
                if swipes >= 15:
                    break
                self.swipe(True)
                swipes += 1
            else:
                time.sleep(.4)
        raise AssertionError(f"Elemento não encontrado na etapa {self.stage}: {text}")

    def tap(self, text: str, *, scroll: bool = False, timeout: float = 35):
        self.tap_node(self.find(text, scroll=scroll, timeout=timeout))

    def tap_tab(self, name: str):
        end = min(self.deadline, time.monotonic() + 25)
        while time.monotonic() < end:
            root = self.snapshot()
            candidates = self.matches(root, name)
            if candidates:
                # A heading can have the same text. Navigation is at the bottom.
                self.tap_node(max(candidates, key=lambda n: bounds(n)[3]))
                return
            time.sleep(.4)
        raise AssertionError(f"Aba não encontrada: {name}")

    def assert_no_login(self, root: ET.Element):
        text = "\n".join(label for node in root.iter("node") for label in node_labels(node))
        for forbidden in FORBIDDEN:
            if forbidden.casefold() in text.casefold():
                raise AssertionError(f"Fluxo remoto indevido encontrado: {forbidden}")

    def assert_tabs(self, root: ET.Element):
        for name in ("Hoje", "Treinos", "Atividades", "Ranking", "Perfil"):
            if not self.matches(root, name):
                raise AssertionError(f"A navegação principal não mostra a aba {name}")

    def screenshot(self, name: str):
        image = self.command("exec-out", "screencap", "-p", timeout=15, binary=True)
        if not image.startswith(b"\x89PNG\r\n\x1a\n"):
            raise AssertionError("A captura nativa não retornou PNG")
        (self.output / name).write_bytes(image)

    def check_point(self) -> ET.Element:
        end = min(self.deadline, time.monotonic() + 35)
        while time.monotonic() < end:
            root = self.snapshot()
            self.assert_no_login(root)
            if not self.matches(root, PROFILE_NAME):
                time.sleep(.35)
                continue
            parents = {child: parent for parent in root.iter() for child in parent}
            for label in root.iter("node"):
                texts = node_labels(label)
                if any(re.fullmatch(r"1\s+Pontos no histórico|Pontos no histórico\s+1", text) for text in texts):
                    return root
                if "Pontos no histórico" not in texts:
                    continue
                container = label
                for _ in range(5):
                    container = parents.get(container)
                    if container is None:
                        break
                    values = [text for n in container.iter("node") for text in node_labels(n)]
                    if any(re.fullmatch(r"1(?:[,.]0+)?", text) for text in values):
                        return root
            time.sleep(.4)
        raise AssertionError("O perfil local não mostrou exatamente 1 ponto no histórico")

    def disable_network(self):
        self.announce("desativando internet no emulador")
        self.shell("cmd", "connectivity", "airplane-mode", "enable")
        self.shell("svc", "wifi", "disable")
        self.shell("svc", "data", "disable")
        time.sleep(.8)
        airplane = self.shell("settings", "get", "global", "airplane_mode_on").strip()
        if airplane != "1":
            raise AssertionError("O modo avião não foi ativado")
        connectivity = self.shell("dumpsys", "connectivity", timeout=15)
        default_network = re.search(r"Active default network:\s*([^\s]+)", connectivity, re.I)
        if default_network and default_network.group(1).lower() not in ("none", "null", "0"):
            raise AssertionError(f"Ainda há rede padrão ativa: {default_network.group(1)}")
        diagnostic = "airplane_mode_on=" + airplane + "\n" + self.shell("cmd", "wifi", "status", check=False)
        diagnostic += "\n" + connectivity
        (self.output / "offline-state.txt").write_text(diagnostic, encoding="utf-8")
        self.checks.append("modo avião ativo, Wi-Fi e dados móveis desativados")

    def launch(self):
        self.shell("input", "keyevent", "KEYCODE_WAKEUP")
        self.shell("wm", "dismiss-keyguard", check=False)
        self.shell("am", "start", "-n", PACKAGE + "/.MainActivity", timeout=20)

    def run(self):
        self.command("wait-for-device", timeout=45)
        dimensions = self.shell("wm", "size")
        found = re.findall(r"(?:Physical|Override) size:\s*(\d+)x(\d+)", dimensions)
        if found:
            self.width, self.height = map(int, found[-1])
        if self.args.reset_data:
            if not self.args.serial or not self.args.serial.startswith("emulator-"):
                raise AssertionError("--reset-data exige --serial emulator-NNNN para não apagar dados de um aparelho pessoal")
            self.shell("pm", "clear", PACKAGE)
        self.disable_network()
        self.launch()
        self.announce("criando perfil pela interface nativa, sem login")
        name_field = self.find("Nome de exibição", timeout=90)
        self.assert_no_login(self.snapshot())
        self.tap_node(name_field)
        self.shell("input", "text", PROFILE_NAME)
        self.shell("input", "keyevent", "KEYCODE_BACK")
        self.tap("Criar perfil neste aparelho", scroll=True, timeout=55)

        self.announce("abrindo o perfil salvo e a navegação principal")
        # Older local migrations can ask for preferences. Defaults are valid;
        # this fallback still operates through the actual UI, with no API seeds.
        end = min(self.deadline, time.monotonic() + 75)
        while time.monotonic() < end:
            root = self.snapshot()
            self.assert_no_login(root)
            if all(self.matches(root, name) for name in ("Hoje", "Treinos", "Atividades", "Ranking", "Perfil")):
                self.assert_tabs(root)
                break
            if self.matches(root, "Seu ritmo, seu ponto de partida") or self.matches(root, "Salvar e começar"):
                self.tap("Salvar e começar", scroll=True, timeout=45)
            else:
                time.sleep(.4)
        else:
            raise AssertionError("O perfil criado não abriu a navegação principal")
        self.checks.append("perfil criado pela UI sem conta Google, OAuth ou servidor")

        self.announce("registrando futebol manual pela interface, com internet desativada")
        self.tap_tab("Atividades")
        self.tap("Registrar esteira, bicicleta interna ou esporte", scroll=True)
        self.tap("Futebol", scroll=True)
        self.tap("Salvar registro manual", scroll=True)
        self.find("Atividades", timeout=35)
        self.tap_tab("Ranking")
        root = self.check_point()
        (self.output / "points-after-save.xml").write_text(ET.tostring(root, encoding="unicode"), encoding="utf-8")
        self.screenshot("01-local-point-offline.png")
        self.checks.append("esporte manual registrado pela UI e 1 ponto local exibido")

        self.announce("reiniciando o processo e verificando persistência offline")
        self.shell("am", "force-stop", PACKAGE)
        self.launch()
        self.find("Ranking", timeout=75)
        self.tap_tab("Ranking")
        root = self.check_point()
        self.assert_tabs(root)
        (self.output / "points-after-restart.xml").write_text(ET.tostring(root, encoding="unicode"), encoding="utf-8")
        self.screenshot("02-local-point-after-restart.png")
        self.checks.append("perfil e ponto preservados após force-stop e reabertura sem rede")
        report = {
            "success": True, "package": PACKAGE, "profile": PROFILE_NAME,
            "device": self.args.serial, "checks": self.checks,
            "limitations": ["não verifica GPS ou sensores físicos", "não verifica seletor de foto", "não mede FPS ou bateria", "não verifica gravação em segundo plano", "registro de futebol é autodeclarado"],
        }
        (self.output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        print("[offline-ui] APROVADO: perfil local, registro manual, 1 ponto e persistência sem internet", flush=True)

    def failure_artifacts(self, error: BaseException):
        (self.output / "failure.txt").write_text(f"Etapa: {self.stage}\n{type(error).__name__}: {error}\n\n" + traceback.format_exc(), encoding="utf-8")
        # Only a fresh test emulator is used. Do not request location, contacts,
        # identity providers or any real health data for this test.
        try:
            self.screenshot("failure.png")
        except Exception:
            pass
        try:
            self.snapshot()
        except Exception:
            pass
        try:
            logs = self.command("logcat", "-d", "-v", "brief", "AndroidRuntime:E", "ReactNativeJS:E", "*:S", timeout=10)
            logs = re.sub(r"(?i)(Bearer\s+)[A-Za-z0-9._-]+", r"\1[redacted]", logs)
            logs = re.sub(r"(?i)(refreshToken|idToken|accessToken)(\s*[:=]\s*)[^\s,]+", r"\1\2[redacted]", logs)
            (self.output / "app-errors.log").write_text(logs[-100000:], encoding="utf-8")
        except Exception:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default=os.environ.get("ANDROID_SERIAL"))
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--output", default="artifacts/emulator")
    parser.add_argument("--timeout", type=float, default=420)
    parser.add_argument("--reset-data", action="store_true")
    args = parser.parse_args()
    smoke = Smoke(args)
    try:
        smoke.run()
    except Exception as error:
        print(f"[offline-ui] FALHOU ({smoke.stage}): {error}", file=sys.stderr, flush=True)
        smoke.failure_artifacts(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
