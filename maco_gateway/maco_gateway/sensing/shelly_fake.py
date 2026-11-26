# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""A stand-in for a Shelly Gen2+ device's local RPC, for tests and the sim.

Transport-free: ``handle`` takes the request line pieces and returns a status
code, headers and a JSON body, so the unit tests wrap it in an
``httpx.MockTransport`` and ``tools/shelly_sim.py`` in an ``http.server``.
Implements just what the gateway uses: ``Shelly.GetStatus``, ``Switch.Set``,
``Switch.GetStatus`` and SHA-256 digest auth.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
from typing import Callable, Dict, Optional, Tuple
from urllib.parse import parse_qs, urlsplit

REALM = "shelly-fake"


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


class FakeShelly:
    def __init__(self, components, password: str = "",
                 on_switch: Optional[Callable[[str, bool], None]] = None) -> None:
        self.password = password
        self.watts: Dict[str, float] = {c: 0.0 for c in components}
        self.output: Dict[str, bool] = {
            c: False for c in components if c.startswith("switch:")}
        self.on_switch = on_switch
        self.requests: list = []
        self._nonce = secrets.token_hex(8)

    # -- auth --

    def challenge(self) -> str:
        return (f'Digest qop="auth", realm="{REALM}", nonce="{self._nonce}", '
                f'algorithm=SHA-256')

    def _authorized(self, method: str, authorization: Optional[str]) -> bool:
        if not self.password:
            return True
        if not authorization or not authorization.startswith("Digest "):
            return False
        fields = dict(re.findall(r'(\w+)="?([^",]*)"?', authorization[7:]))
        if fields.get("username") != "admin" or fields.get("nonce") != self._nonce:
            return False
        if fields.get("algorithm", "").upper() != "SHA-256":
            return False
        ha1 = _sha256(f"admin:{REALM}:{self.password}")
        ha2 = _sha256(f"{method}:{fields.get('uri', '')}")
        expected = _sha256(":".join([ha1, self._nonce, fields.get("nc", ""),
                                     fields.get("cnonce", ""), fields.get("qop", ""),
                                     ha2]))
        return secrets.compare_digest(expected, fields.get("response", ""))

    # -- rpc --

    def status(self) -> dict:
        out = {}
        for comp, watts in self.watts.items():
            kind, _, idx = comp.partition(":")
            entry = {"id": int(idx)}
            if kind == "switch":
                on = self.output[comp]
                entry.update(output=on, apower=watts if on else 0.0)
            elif kind.startswith("em"):
                entry.update(act_power=watts)
            else:
                entry.update(apower=watts)
            out[comp] = entry
        return out

    def handle(self, method: str, url: str,
               authorization: Optional[str] = None) -> Tuple[int, Dict[str, str], dict]:
        self.requests.append(url)
        if not self._authorized(method, authorization):
            return 401, {"WWW-Authenticate": self.challenge()}, {}
        parts = urlsplit(url)
        query = {k: v[0] for k, v in parse_qs(parts.query).items()}
        rpc = parts.path.removeprefix("/rpc/")
        if rpc == "Shelly.GetStatus":
            return 200, {}, self.status()
        if rpc in ("Switch.Set", "Switch.GetStatus"):
            comp = f"switch:{query.get('id', '0')}"
            if comp not in self.output:
                return 404, {}, {"code": -105, "message": f"no {comp}"}
            if rpc == "Switch.GetStatus":
                return 200, {}, self.status()[comp]
            was_on = self.output[comp]
            on = json.loads(query.get("on", "false"))
            self.output[comp] = bool(on)
            if self.on_switch is not None and was_on != bool(on):
                self.on_switch(comp, bool(on))
            return 200, {}, {"was_on": was_on}
        return 404, {}, {"code": -114, "message": f"no method {rpc}"}
