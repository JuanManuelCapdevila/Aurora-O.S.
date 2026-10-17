"""NetworkManager para Aurora (vía nmcli): buscar redes, conectar, olvidar.

Lo usan las vistas gráficas de aurora-settings. Las funciones de análisis
(split_terse, parse_networks, signal_level, friendly_error) no tocan el
sistema y tienen tests en tests/test_nm.py.
"""

import subprocess


def split_terse(line):
    """Separa una línea de `nmcli -t`: los campos van con ':' y nmcli escapa
    ':' y '\\' dentro de los valores con una barra invertida."""
    fields, buf, escaped = [], [], False
    for ch in line:
        if escaped:
            buf.append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == ":":
            fields.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    fields.append("".join(buf))
    return fields


def parse_networks(output):
    """Lista de redes únicas (la de mejor señal por nombre), ordenadas por señal."""
    best = {}
    for line in output.splitlines():
        if not line.strip():
            continue
        fields = split_terse(line)
        if len(fields) < 4:
            continue
        in_use, ssid, signal, security = fields[:4]
        if not ssid:
            continue  # redes ocultas
        net = {
            "ssid": ssid,
            "signal": int(signal) if signal.isdigit() else 0,
            "secure": security not in ("", "--"),
            "active": in_use.strip() == "*",
        }
        prev = best.get(ssid)
        if prev is None or net["signal"] > prev["signal"] or net["active"]:
            if prev is not None:
                net["active"] = net["active"] or prev["active"]
            best[ssid] = net
    return sorted(best.values(), key=lambda n: (not n["active"], -n["signal"], n["ssid"].lower()))


def signal_level(signal):
    """Nivel de 0 a 4 para dibujar las barras de señal."""
    return 0 if signal < 20 else 1 if signal < 40 else 2 if signal < 60 else 3 if signal < 80 else 4


def nmcli(*args, timeout=45):
    try:
        res = subprocess.run(["nmcli", *args], capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as err:
        return False, str(err)
    return res.returncode == 0, (res.stdout or res.stderr).strip()


def wifi_device():
    ok, out = nmcli("-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device")
    if not ok:
        return None
    for line in out.splitlines():
        dev, typ, state, conn = (split_terse(line) + ["", "", "", ""])[:4]
        if typ == "wifi":
            return {"device": dev, "state": state, "connection": conn}
    return None


def known_connections():
    ok, out = nmcli("-t", "-f", "NAME,TYPE", "connection", "show")
    names = set()
    if ok:
        for line in out.splitlines():
            fields = split_terse(line)
            if len(fields) >= 2 and fields[1] in ("802-11-wireless", "wifi"):
                names.add(fields[0])
    return names


def scan():
    ok, out = nmcli("-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "yes")
    return parse_networks(out) if ok else []


def friendly_error(out):
    """Traduce los errores más comunes de NetworkManager."""
    low = out.lower()
    if "secrets were required" in low or "802-1x" in low or "invalid passphrase" in low or "psk" in low:
        return "La contraseña es incorrecta."
    if "no network with ssid" in low:
        return "La red ya no está disponible. Buscá de nuevo."
    if "timeout" in low or "timed out" in low:
        return "La red no respondió a tiempo. Acercate al router y probá de nuevo."
    return out[:300] or "Error desconocido."


def connect(net, password=None, known=False):
    if known:
        return nmcli("connection", "up", "id", net["ssid"], timeout=60)
    args = ["device", "wifi", "connect", net["ssid"]]
    if password:
        args += ["password", password]
    ok, out = nmcli(*args, timeout=60)
    if not ok:
        # nmcli deja el perfil creado aunque falle: se borra para no recordar una clave mala.
        nmcli("connection", "delete", "id", net["ssid"])
    return ok, out
