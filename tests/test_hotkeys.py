"""Tests de aurora-hotkeys: combinación de botones, pausa y cierre del juego.

python-evdev se reemplaza por un módulo falso; los procesos son reales.
"""

import importlib.machinery
import importlib.util
import json
import os
import pathlib
import signal
import stat
import subprocess
import sys
import tempfile
import time
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

ecodes = types.SimpleNamespace(BTN_SELECT=314, BTN_START=315, BTN_MODE=316, BTN_SOUTH=304, EV_KEY=1,
                               KEY_LEFTMETA=125, KEY_G=34)
sys.modules.setdefault("evdev", types.SimpleNamespace(ecodes=ecodes))
sys.modules.setdefault("evdev.ecodes", ecodes)
loader = importlib.machinery.SourceFileLoader("hotkeys", str(ROOT / "rootfs/usr/local/bin/aurora-hotkeys"))
spec = importlib.util.spec_from_loader("hotkeys", loader)
hotkeys = importlib.util.module_from_spec(spec)
loader.exec_module(hotkeys)
e = hotkeys.e


def state(pid):
    with open(f"/proc/{pid}/stat") as f:
        return f.read().rsplit(")", 1)[1].split()[0]


class ComboTest(unittest.TestCase):
    def test_select_start_y_soltar_abre_el_menu(self):
        c = hotkeys.Combo()
        c.feed(e.BTN_SELECT, 1)
        c.feed(e.BTN_START, 1)
        self.assertIsNone(c.tick(0.0))
        self.assertIsNone(c.tick(0.5))
        c.feed(e.BTN_START, 0)
        self.assertEqual(c.tick(0.6), "menu")
        c.feed(e.BTN_SELECT, 0)
        self.assertIsNone(c.tick(0.7))

    def test_mantener_dos_segundos_cierra_una_sola_vez(self):
        c = hotkeys.Combo()
        c.feed(e.BTN_SELECT, 1)
        c.feed(e.BTN_START, 1)
        c.tick(0.0)
        self.assertEqual(c.tick(2.1), "close")
        self.assertIsNone(c.tick(3.0))
        c.feed(e.BTN_SELECT, 0)
        self.assertIsNone(c.tick(3.1))  # al soltar no abre además el menú

    def test_un_solo_boton_no_hace_nada(self):
        c = hotkeys.Combo()
        c.feed(e.BTN_START, 1)
        self.assertIsNone(c.tick(5.0))
        c.feed(e.BTN_START, 0)
        self.assertIsNone(c.tick(5.1))

    def test_boton_windows_de_la_win600_abre_el_menu(self):
        c = hotkeys.Combo()
        self.assertIsNone(c.feed(e.KEY_LEFTMETA, 1))
        self.assertEqual(c.feed(e.KEY_G, 1), "menu")

    def test_boton_guia_abre_el_menu(self):
        self.assertEqual(hotkeys.Combo().feed(e.BTN_MODE, 1), "menu")


class GameProcessTest(unittest.TestCase):
    def setUp(self):
        # Un "juego" (sh) con un hijo (sh) y un nieto (sleep), en su propio grupo como lo lanza aurora.
        self.game = subprocess.Popen(["sh", "-c", "sh -c 'sleep 60 & wait' & wait"], start_new_session=True)
        deadline = time.monotonic() + 5
        while len(hotkeys.process_tree(self.game.pid)) < 3 and time.monotonic() < deadline:
            time.sleep(0.05)
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        hotkeys.signal_tree(self.game.pid, signal.SIGKILL)
        self.game.wait()
        self.tmp.cleanup()

    def fake_settings(self, code):
        """aurora-settings falso: anota el estado del juego y sale con `code`."""
        bin_dir = pathlib.Path(self.tmp.name)
        script = bin_dir / "aurora-settings"
        script.write_text(
            "#!/bin/sh\n"
            f"cat /proc/{self.game.pid}/stat > {bin_dir}/during\n"
            f'echo "$AURORA_GAME_NAME" > {bin_dir}/name\n'
            f"exit {code}\n"
        )
        script.chmod(script.stat().st_mode | stat.S_IEXEC)
        return bin_dir

    def test_arbol_de_procesos(self):
        self.assertEqual(len(hotkeys.process_tree(self.game.pid)), 3)

    def test_menu_pausa_y_reanuda(self):
        bin_dir = self.fake_settings(0)
        old = os.environ["PATH"]
        os.environ["PATH"] = f"{bin_dir}:{old}"
        try:
            hotkeys.open_menu({"pid": self.game.pid, "name": "Vice City"})
        finally:
            os.environ["PATH"] = old
        self.assertEqual((bin_dir / "during").read_text().rsplit(")", 1)[1].split()[0], "T")
        self.assertEqual((bin_dir / "name").read_text().strip(), "Vice City")
        self.assertNotEqual(state(self.game.pid), "T")
        self.assertIsNone(self.game.poll())

    def test_cerrar_desde_el_menu_termina_todo(self):
        bin_dir = self.fake_settings(hotkeys.EXIT_CLOSE)
        tree = hotkeys.process_tree(self.game.pid)
        old = os.environ["PATH"]
        os.environ["PATH"] = f"{bin_dir}:{old}"
        try:
            hotkeys.open_menu({"pid": self.game.pid, "name": "Vice City"})
        finally:
            os.environ["PATH"] = old
        self.game.wait(timeout=5)
        time.sleep(0.2)
        self.assertFalse([p for p in tree[1:] if hotkeys.alive(p)])

    def test_running_game(self):
        path = pathlib.Path(self.tmp.name) / "running-game.json"
        hotkeys.STATE = str(path)
        self.assertIsNone(hotkeys.running_game())
        path.write_text(json.dumps({"id": "vc", "name": "Vice City", "pid": self.game.pid}))
        self.assertEqual(hotkeys.running_game()["id"], "vc")
        path.write_text(json.dumps({"id": "vc", "name": "Vice City", "pid": 2**22 + 1}))
        self.assertIsNone(hotkeys.running_game())


if __name__ == "__main__":
    unittest.main()
