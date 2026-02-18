# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Personalize TUI plugin for pw_console.

Polls the device for tag state and sends diversified keys
for personalization. Supports manual (press 'p') and auto modes.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field

from prompt_toolkit.filters import has_focus
from prompt_toolkit.formatted_text import FormattedText
from prompt_toolkit.key_binding import KeyBindings, KeyPressEvent
from prompt_toolkit.layout import FormattedTextControl, Window, WindowAlign
from prompt_toolkit.mouse_events import MouseEvent, MouseEventType

from pw_console.plugin_mixin import PluginMixin
from pw_console.widgets import ToolbarButton, WindowPane, WindowPaneToolbar
from pw_console.get_pw_console_app import get_pw_console_app

from tools.ntag_key_diversification import diversify_keys


_LOG = logging.getLogger(__name__)

# Maximum log entries to keep in scrolling history
_MAX_LOG_ENTRIES = 100

# Proto enum values for GetPersonalizeStateResponse.State
_STATE_IDLE = 0
_STATE_PROBING = 1
_STATE_FACTORY_TAG = 2
_STATE_MACO_TAG = 3
_STATE_UNKNOWN_TAG = 4
_STATE_AWAITING_KEYS = 5
_STATE_PERSONALIZING = 6
_STATE_PERSONALIZED = 7
_STATE_ERROR = 8

_STATE_NAMES = {
    _STATE_IDLE: "idle",
    _STATE_PROBING: "probing",
    _STATE_FACTORY_TAG: "factory",
    _STATE_MACO_TAG: "maco",
    _STATE_UNKNOWN_TAG: "unknown",
    _STATE_AWAITING_KEYS: "awaiting_keys",
    _STATE_PERSONALIZING: "personalizing",
    _STATE_PERSONALIZED: "personalized",
    _STATE_ERROR: "error",
}


@dataclass
class TagLogEntry:
    """One personalization attempt in the scrolling log."""
    uid_hex: str
    tag_type: str
    status: str  # "pending", "personalizing", "ok", "fail", "skipped"
    message: str = ""
    timestamp: float = field(default_factory=time.monotonic)


class PersonalizeControl(FormattedTextControl):
    """Rendering control with key bindings for the personalize pane."""

    def __init__(self, pane: PersonalizePane, *args, **kwargs) -> None:
        self.pane = pane

        key_bindings = KeyBindings()

        @key_bindings.add("p")
        def _personalize(_event: KeyPressEvent) -> None:
            self.pane.personalize_current()

        @key_bindings.add("a")
        def _toggle_auto(_event: KeyPressEvent) -> None:
            self.pane.toggle_auto_mode()

        @key_bindings.add("r")
        def _reset(_event: KeyPressEvent) -> None:
            self.pane.reset_log()

        kwargs["key_bindings"] = key_bindings
        super().__init__(*args, **kwargs)

    def mouse_handler(self, mouse_event: MouseEvent):
        if not has_focus(self.pane)():
            if mouse_event.event_type == MouseEventType.MOUSE_UP:
                get_pw_console_app().focus_on_container(self.pane)
                return None
        return NotImplemented


class PersonalizePane(WindowPane, PluginMixin):
    """Tag personalization pane for pw_console.

    Polls GetPersonalizeState every 500ms to detect tags, then sends
    diversified keys via PersonalizeTag when requested.
    """

    def __init__(
        self,
        device=None,
        master_key: bytes = b"",
        terminal_key: bytes = b"",
        system_name: str = "OwwMachineAuth",
        *args,
        **kwargs,
    ):
        super().__init__(*args, pane_title="Personalize", **kwargs)
        self._device = device
        self._master_key = master_key
        self._terminal_key = terminal_key
        self._system_name = system_name

        self._auto_mode = False
        self._current_uid: bytes | None = None
        self._current_tag_type: str = ""
        self._current_state: int = _STATE_IDLE
        self._prev_state: int = _STATE_IDLE
        self._log: list[TagLogEntry] = []
        self._lock = threading.Lock()

        self._control = PersonalizeControl(
            self,
            self._get_formatted_text,
            show_cursor=False,
            focusable=True,
        )

        self._window = Window(
            content=self._control,
            align=WindowAlign.LEFT,
            dont_extend_width=False,
            dont_extend_height=False,
        )

        self.bottom_toolbar = WindowPaneToolbar(self)
        self.bottom_toolbar.add_button(
            ToolbarButton(key="p", description="Personalize")
        )
        self.bottom_toolbar.add_button(
            ToolbarButton(key="a", description="Toggle Auto")
        )
        self.bottom_toolbar.add_button(
            ToolbarButton(
                key="r",
                description="Reset Log",
                mouse_handler=self.reset_log,
            )
        )

        self.container = self._create_pane_container(
            self._window,
            self.bottom_toolbar,
        )

        self.plugin_init(
            plugin_callback=self._background_task,
            plugin_callback_frequency=0.5,
            plugin_logger_name="personalize_pane",
        )

    # ── Actions ───────────────────────────────────────────────────────

    def personalize_current(self) -> None:
        """Request personalization for the currently detected tag."""
        with self._lock:
            if self._current_uid is None:
                return
            uid = self._current_uid
            uid_hex = uid.hex()
        threading.Thread(
            target=self._do_personalize,
            args=(uid, uid_hex),
            daemon=True,
            name="personalize",
        ).start()

    def toggle_auto_mode(self) -> None:
        """Toggle automatic personalization of factory tags."""
        with self._lock:
            self._auto_mode = not self._auto_mode
            mode = "ON" if self._auto_mode else "OFF"
        _LOG.info("Auto mode: %s", mode)
        self.redraw_ui()

    def reset_log(self) -> None:
        """Clear the personalization log."""
        with self._lock:
            self._log.clear()
        self.redraw_ui()

    # ── Polling ───────────────────────────────────────────────────────

    def _background_task(self) -> bool:
        """PluginMixin callback: poll device state."""
        try:
            self._poll_state()
        except Exception as e:
            _LOG.error("Poll error: %s", e)
        return True

    def _poll_state(self) -> None:
        """Call GetPersonalizeState and update pane."""
        personalize_svc = (
            self._device.rpcs.maco.PersonalizationService
        )
        status, resp = personalize_svc.GetPersonalizeState()
        if not status.ok():
            return

        state = resp.state
        uid = bytes(resp.uid) if resp.uid else b""
        uid_hex = uid.hex() if uid else ""
        error_msg = resp.error_message

        tag_type_str = {
            _STATE_FACTORY_TAG: "factory",
            _STATE_MACO_TAG: "maco",
            _STATE_UNKNOWN_TAG: "unknown",
        }.get(state, "")

        with self._lock:
            prev = self._prev_state
            self._current_state = state
            self._prev_state = state

            # Detect state transitions
            if state != prev:
                self._handle_transition(
                    prev, state, uid, uid_hex, tag_type_str, error_msg
                )

    def _handle_transition(
        self,
        prev: int,
        state: int,
        uid: bytes,
        uid_hex: str,
        tag_type_str: str,
        error_msg: str,
    ) -> None:
        """Handle state transitions. Called with _lock held."""
        state_name = _STATE_NAMES.get(state, "?")
        _LOG.info("State: %s -> %s uid=%s", _STATE_NAMES.get(prev), state_name, uid_hex)

        if state in (_STATE_FACTORY_TAG, _STATE_MACO_TAG,
                     _STATE_AWAITING_KEYS):
            self._current_uid = uid
            self._current_tag_type = tag_type_str or "factory"

            # Only add log entry on first detection (not awaiting_keys)
            if prev in (_STATE_IDLE, _STATE_PROBING):
                entry = TagLogEntry(
                    uid_hex=uid_hex,
                    tag_type=self._current_tag_type,
                    status="pending",
                )
                self._log.append(entry)
                self._trim_log()

            # Auto-personalize factory tags
            if (state == _STATE_AWAITING_KEYS
                    and self._auto_mode
                    and self._current_tag_type == "factory"):
                uid_copy = uid
                uid_hex_copy = uid_hex
                # Release lock before RPC
                threading.Thread(
                    target=self._do_personalize,
                    args=(uid_copy, uid_hex_copy),
                    daemon=True,
                    name="personalize",
                ).start()

        elif state == _STATE_PERSONALIZING:
            self._update_last_entry(uid_hex, "personalizing", "")

        elif state == _STATE_PERSONALIZED:
            self._update_last_entry(uid_hex, "ok", "")
            self._current_uid = uid
            self._current_tag_type = "maco"

        elif state == _STATE_ERROR:
            self._update_last_entry(uid_hex, "fail", error_msg)

        elif state == _STATE_IDLE:
            self._current_uid = None
            self._current_tag_type = ""

    def _do_personalize(self, uid: bytes, uid_hex: str) -> None:
        """Diversify keys and send PersonalizeTag RPC."""
        with self._lock:
            self._update_last_entry(uid_hex, "personalizing", "")

        self.redraw_ui()

        try:
            keys = diversify_keys(self._master_key, self._system_name, uid)

            personalize_svc = (
                self._device.rpcs.maco.PersonalizationService
            )
            status, resp = personalize_svc.PersonalizeTag(
                uid=uid,
                application_key=keys["application"],
                terminal_key=self._terminal_key,
                authorization_key=keys["authorization"],
                sdm_mac_key=keys["sdm_mac"],
                reserved2_key=keys["reserved2"],
            )

            if not status.ok():
                with self._lock:
                    self._update_last_entry(uid_hex, "fail", "RPC failed")
                _LOG.error("PersonalizeTag RPC failed: %s", status)

        except Exception as e:
            with self._lock:
                self._update_last_entry(uid_hex, "fail", str(e))
            _LOG.error("Personalization error: %s", e)

    def _update_last_entry(
        self, uid_hex: str, status: str, message: str
    ) -> None:
        """Update the most recent log entry matching this UID."""
        for entry in reversed(self._log):
            if entry.uid_hex == uid_hex:
                entry.status = status
                entry.message = message
                return

    def _trim_log(self) -> None:
        """Keep log size bounded."""
        while len(self._log) > _MAX_LOG_ENTRIES:
            self._log.pop(0)

    # ── Rendering ─────────────────────────────────────────────────────

    def _get_formatted_text(self) -> FormattedText:
        fragments: list[tuple[str, str]] = []
        nl = ("", "\n")

        with self._lock:
            auto_mode = self._auto_mode
            current_uid = self._current_uid
            current_tag_type = self._current_tag_type
            current_state = self._current_state
            log_copy = list(self._log)

        ok_count = sum(1 for e in log_copy if e.status == "ok")
        fail_count = sum(1 for e in log_copy if e.status == "fail")

        # Header
        mode_str = "AUTO" if auto_mode else "MANUAL"
        mode_style = "class:theme-fg-green" if auto_mode else "class:theme-fg-cyan"
        fragments.append(("class:theme-fg-cyan", "  Personalize"))
        fragments.append(("", "  "))
        fragments.append((mode_style, f"[{mode_str}]"))
        if ok_count or fail_count:
            fragments.append(("", "  "))
            fragments.append(("class:theme-fg-green", f"{ok_count} ok"))
            if fail_count:
                fragments.append(("", " / "))
                fragments.append(("class:theme-fg-red", f"{fail_count} fail"))
        fragments.append(nl)
        fragments.append(("class:theme-fg-dim", "  " + "\u2500" * 48))
        fragments.append(nl)

        # Current tag
        state_name = _STATE_NAMES.get(current_state, "?")
        if current_uid:
            uid_hex = current_uid.hex()
            fragments.append(("", "  Current: "))
            type_style = (
                "class:theme-fg-yellow" if current_tag_type == "factory"
                else "class:theme-fg-cyan"
            )
            fragments.append((type_style, f"[{current_tag_type}]"))
            fragments.append(("", " "))
            fragments.append(("bold", uid_hex))
            if current_state == _STATE_AWAITING_KEYS:
                fragments.append(("", " "))
                fragments.append(("class:theme-fg-yellow", "(press p)"))
            elif current_state == _STATE_PERSONALIZING:
                fragments.append(("", " "))
                fragments.append(("class:theme-fg-cyan", "(writing...)"))
            fragments.append(nl)
        else:
            fragments.append(("class:theme-fg-dim", f"  {state_name}"))
            fragments.append(nl)

        fragments.append(("class:theme-fg-dim", "  " + "\u2500" * 48))
        fragments.append(nl)

        # Log entries (most recent first)
        if not log_copy:
            fragments.append(("class:theme-fg-dim", "  No history"))
            fragments.append(nl)
        else:
            for entry in reversed(log_copy[-20:]):
                icon, icon_style = self._status_icon(entry.status)
                fragments.append(("", "  "))
                fragments.append((icon_style, f"[{icon}]"))
                fragments.append(("", " "))
                fragments.append(("", entry.uid_hex))
                fragments.append(("", " "))
                fragments.append(("class:theme-fg-dim", f"({entry.tag_type})"))
                if entry.message:
                    fragments.append(("", " "))
                    msg_style = (
                        "class:theme-fg-red" if entry.status == "fail"
                        else "class:theme-fg-dim"
                    )
                    fragments.append((msg_style, entry.message))
                fragments.append(nl)

        return FormattedText(fragments)

    @staticmethod
    def _status_icon(status: str) -> tuple[str, str]:
        match status:
            case "pending":
                return ".", ""
            case "personalizing":
                return "~", "class:theme-fg-cyan"
            case "ok":
                return "\u2713", "class:theme-fg-green"
            case "fail":
                return "\u2717", "class:theme-fg-red"
            case "skipped":
                return "-", "class:theme-fg-dim"
            case _:
                return "?", ""

    def get_all_key_bindings(self) -> list:
        return [
            {
                "Personalize current tag": ["p"],
                "Toggle auto mode": ["a"],
                "Reset log": ["r"],
            }
        ]
