"""Tests de las funciones puras de aurora_nm (sin NetworkManager)."""

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "rootfs/usr/lib/aurora/python"))
import aurora_nm as wifi  # noqa: E402


class SplitTerse(unittest.TestCase):
    def test_campos_simples(self):
        self.assertEqual(wifi.split_terse("*:Casa:72:WPA2"), ["*", "Casa", "72", "WPA2"])

    def test_dos_puntos_y_barras_escapados(self):
        self.assertEqual(wifi.split_terse(r" :Bar\:Wifi:30:"), [" ", "Bar:Wifi", "30", ""])
        self.assertEqual(wifi.split_terse(r" :C\\D:10:WPA2"), [" ", "C\\D", "10", "WPA2"])


class ParseNetworks(unittest.TestCase):
    OUTPUT = "\n".join([
        " :Casa:50:WPA2",
        "*:Casa:72:WPA2",
        " :Vecino 5G:45:WPA2 WPA3",
        r" :Bar\:Wifi:30:",
        " ::60:WPA2",
        " :Oficina:88:WPA1",
        "",
    ])

    def test_deduplica_ordena_y_omite_ocultas(self):
        nets = wifi.parse_networks(self.OUTPUT)
        self.assertEqual([n["ssid"] for n in nets], ["Casa", "Oficina", "Vecino 5G", "Bar:Wifi"])

    def test_la_conectada_va_primero_con_su_mejor_señal(self):
        casa = wifi.parse_networks(self.OUTPUT)[0]
        self.assertEqual((casa["active"], casa["signal"], casa["secure"]), (True, 72, True))

    def test_red_abierta(self):
        bar = [n for n in wifi.parse_networks(self.OUTPUT) if n["ssid"] == "Bar:Wifi"][0]
        self.assertFalse(bar["secure"])


class Helpers(unittest.TestCase):
    def test_nivel_de_señal(self):
        self.assertEqual([wifi.signal_level(s) for s in (10, 30, 50, 72, 95)], [0, 1, 2, 3, 4])

    def test_errores_amigables(self):
        msg = "Error: Connection activation failed: Secrets were required, but not provided."
        self.assertEqual(wifi.friendly_error(msg), "La contraseña es incorrecta.")
        self.assertIn("no está disponible", wifi.friendly_error("Error: No network with SSID 'X' found."))


if __name__ == "__main__":
    unittest.main()
