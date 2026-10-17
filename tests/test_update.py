"""Tests de aurora-update contra una raíz temporal y paquetes armados en el test."""

import hashlib
import io
import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "rootfs/usr/local/bin/aurora-update"


@unittest.skipUnless(shutil.which("zstd") and shutil.which("jq"), "necesita zstd y jq")
class UpdateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.root = self.tmp / "root"
        self.server = self.tmp / "server"
        self.server.mkdir()
        # Sistema instalado con la versión 1 (como queda después del ISO).
        self.publish("1", {"usr/local/bin/aurora-a": "a1", "usr/local/bin/aurora-viejo": "viejo",
                           "etc/aurora/kernel-params": "video=eDP-1:panel_orientation=left_side_up"})
        self.run_update("apply")
        (self.root / "boot/loader/entries").mkdir(parents=True)
        self.entry = self.root / "boot/loader/entries/aurora.conf"
        self.entry.write_text("title Aurora\noptions root=PARTUUID=x rw quiet "
                              "video=eDP-1:panel_orientation=left_side_up\n")
        (self.root / "home/player").mkdir(parents=True)
        (self.root / "home/player/partida.sav").write_text("guardado")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def publish(self, version, files):
        layer = self.tmp / f"layer-{version}"
        files = {**files, "etc/aurora/version": version}
        for path, content in files.items():
            (layer / path).parent.mkdir(parents=True, exist_ok=True)
            (layer / path).write_text(content + "\n")
        archive = self.server / "aurora-update.tar.zst"
        subprocess.run(["tar", "-C", layer, "--zstd", "-cf", archive, *sorted(files)], check=True)
        manifest = {"version": version, "file": archive.name, "size": archive.stat().st_size,
                    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "packages": [], "aur": []}
        (self.server / "aurora-update.json").write_text(json.dumps(manifest))

    def run_update(self, *args, ok=True):
        env = dict(os.environ, AURORA_ROOT=str(self.root), AURORA_UPDATE_URL=f"file://{self.server}",
                   AURORA_SKIP_PACKAGES="1")
        res = subprocess.run(["bash", SCRIPT, *args], env=env, capture_output=True, text=True)
        if ok:
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        return res

    def read(self, path):
        return (self.root / path).read_text().strip()

    def test_check(self):
        self.assertEqual(self.run_update("check", ok=False).returncode, 1)
        self.publish("2", {"usr/local/bin/aurora-a": "a2"})
        res = self.run_update("check")
        self.assertIn("Disponible: 2", res.stdout)

    def test_actualizar_y_volver_atras(self):
        self.publish("2", {"usr/local/bin/aurora-a": "a2", "usr/local/bin/aurora-nuevo": "nuevo",
                           "etc/aurora/kernel-params": "video=eDP-1:panel_orientation=right_side_up"})
        out = self.run_update("apply").stdout
        self.assertIn("Aurora actualizado a 2", out)
        self.assertEqual(self.read("etc/aurora/version"), "2")
        self.assertEqual(self.read("usr/local/bin/aurora-a"), "a2")
        self.assertEqual(self.read("usr/local/bin/aurora-nuevo"), "nuevo")
        self.assertFalse((self.root / "usr/local/bin/aurora-viejo").exists())
        self.assertIn("options root=PARTUUID=x rw quiet video=eDP-1:panel_orientation=right_side_up\n",
                      self.entry.read_text())
        self.assertEqual(self.read("home/player/partida.sav"), "guardado")
        self.assertIn("ya está actualizado", self.run_update("apply").stdout)

        out = self.run_update("rollback").stdout
        self.assertIn("Se volvió de 2 a 1", out)
        self.assertEqual(self.read("usr/local/bin/aurora-a"), "a1")
        self.assertEqual(self.read("usr/local/bin/aurora-viejo"), "viejo")
        self.assertFalse((self.root / "usr/local/bin/aurora-nuevo").exists())
        self.assertIn("panel_orientation=left_side_up\n", self.entry.read_text())
        self.assertNotEqual(self.run_update("rollback", ok=False).returncode, 0)

    def test_descarga_danada_no_toca_nada(self):
        self.publish("2", {"usr/local/bin/aurora-a": "a2"})
        manifest = json.loads((self.server / "aurora-update.json").read_text())
        manifest["sha256"] = "0" * 64
        (self.server / "aurora-update.json").write_text(json.dumps(manifest))
        res = self.run_update("apply", ok=False)
        self.assertEqual(res.returncode, 2)
        self.assertIn("dañada", res.stderr)
        self.assertEqual(self.read("etc/aurora/version"), "1")
        self.assertEqual(self.read("usr/local/bin/aurora-a"), "a1")

    def test_rutas_peligrosas(self):
        # GNU tar limpia los ".." al crear: el paquete malicioso se arma con tarfile.
        plain = self.tmp / "malo.tar"
        with tarfile.open(plain, "w") as tar:
            info = tarfile.TarInfo("usr/../../afuera")
            info.size = 1
            tar.addfile(info, io.BytesIO(b"x"))
        archive = self.server / "aurora-update.tar.zst"
        subprocess.run(["zstd", "-qf", plain, "-o", archive], check=True)
        manifest = {"version": "3", "file": archive.name, "size": 1, "packages": [], "aur": [],
                    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}
        (self.server / "aurora-update.json").write_text(json.dumps(manifest))
        res = self.run_update("apply", ok=False)
        self.assertIn("ruta inválida", res.stderr)
        self.assertFalse((self.tmp / "afuera").exists())
        self.assertEqual(self.read("etc/aurora/version"), "1")


if __name__ == "__main__":
    unittest.main()
