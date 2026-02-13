# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Factory test TUI plugin for pw_console.

Interactive checklist pane that guides an operator through hardware tests
and provisioning steps. Auto-tests run RPCs and check results; visual tests
activate a pattern and wait for operator confirmation.
"""

from __future__ import annotations

import enum
import logging
import os
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


_LOG = logging.getLogger(__name__)


class StepStatus(enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    CONFIRM = "confirm"
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


class StepMode(enum.Enum):
    AUTO = "auto"
    VISUAL = "visual"


@dataclass
class TestStep:
    name: str
    mode: StepMode
    status: StepStatus = StepStatus.PENDING
    message: str = ""
    duration: float | None = None


class FactoryTestControl(FormattedTextControl):
    """Rendering control with key bindings for the factory test pane."""

    def __init__(self, pane: FactoryTestPane, *args, **kwargs) -> None:
        self.pane = pane

        key_bindings = KeyBindings()

        @key_bindings.add("j")
        @key_bindings.add("down")
        def _next(_event: KeyPressEvent) -> None:
            self.pane.select_next()

        @key_bindings.add("k")
        @key_bindings.add("up")
        def _prev(_event: KeyPressEvent) -> None:
            self.pane.select_prev()

        @key_bindings.add("enter")
        def _run(_event: KeyPressEvent) -> None:
            self.pane.run_selected()

        @key_bindings.add("a")
        def _run_all(_event: KeyPressEvent) -> None:
            self.pane.run_all()

        @key_bindings.add("p")
        def _pass(_event: KeyPressEvent) -> None:
            self.pane.confirm_pass()

        @key_bindings.add("f")
        def _fail(_event: KeyPressEvent) -> None:
            self.pane.confirm_fail()

        @key_bindings.add("s")
        def _skip(_event: KeyPressEvent) -> None:
            self.pane.skip_selected()

        @key_bindings.add("r")
        def _reset(_event: KeyPressEvent) -> None:
            self.pane.reset_all()

        kwargs["key_bindings"] = key_bindings
        super().__init__(*args, **kwargs)

    def mouse_handler(self, mouse_event: MouseEvent):
        if not has_focus(self.pane)():
            if mouse_event.event_type == MouseEventType.MOUSE_UP:
                get_pw_console_app().focus_on_container(self.pane)
                return None
        return NotImplemented


class FactoryTestPane(WindowPane, PluginMixin):
    """Interactive factory test checklist for pw_console."""

    def __init__(self, device=None, *args, **kwargs):
        super().__init__(*args, pane_title="Factory Test", **kwargs)
        self._device = device

        self._steps: list[TestStep] = [
            TestStep("Echo Test", StepMode.AUTO),
            TestStep("LED Red", StepMode.VISUAL),
            TestStep("LED Green", StepMode.VISUAL),
            TestStep("LED Blue", StepMode.VISUAL),
            TestStep("LED White", StepMode.VISUAL),
            TestStep("LED Clear", StepMode.AUTO),
            TestStep("Display White", StepMode.VISUAL),
            TestStep("Display Color Bars", StepMode.VISUAL),
            TestStep("Check Secrets", StepMode.AUTO),
            TestStep("Provision Secrets", StepMode.AUTO),
            TestStep("Verify Provisioned", StepMode.AUTO),
        ]
        self._selected: int = 0
        self._run_request: int | None = None
        self._run_all_mode: bool = False

        self._control = FactoryTestControl(
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
            ToolbarButton(key="Enter", description="Run")
        )
        self.bottom_toolbar.add_button(
            ToolbarButton(key="a", description="Run All")
        )
        self.bottom_toolbar.add_button(
            ToolbarButton(key="p", description="Pass")
        )
        self.bottom_toolbar.add_button(
            ToolbarButton(key="f", description="Fail")
        )
        self.bottom_toolbar.add_button(
            ToolbarButton(key="s", description="Skip")
        )
        self.bottom_toolbar.add_button(
            ToolbarButton(
                key="r",
                description="Reset",
                mouse_handler=self.reset_all,
            )
        )

        self.container = self._create_pane_container(
            self._window,
            self.bottom_toolbar,
        )

        self.plugin_init(
            plugin_callback=self._background_task,
            plugin_callback_frequency=0.3,
            plugin_logger_name="factory_test_pane",
        )

    # ── Navigation ────────────────────────────────────────────────────

    def select_next(self) -> None:
        if self._selected < len(self._steps) - 1:
            self._selected += 1
            self.redraw_ui()

    def select_prev(self) -> None:
        if self._selected > 0:
            self._selected -= 1
            self.redraw_ui()

    # ── Actions (UI thread → background thread via flag) ──────────────

    def run_selected(self) -> None:
        step = self._steps[self._selected]
        if step.status in (StepStatus.RUNNING, StepStatus.CONFIRM):
            return
        self._run_all_mode = False
        self._run_request = self._selected

    def run_all(self) -> None:
        self._run_all_mode = True
        # Find first non-completed step
        for i, step in enumerate(self._steps):
            if step.status not in (
                StepStatus.PASSED,
                StepStatus.FAILED,
                StepStatus.SKIPPED,
            ):
                self._run_request = i
                self._selected = i
                break

    def confirm_pass(self) -> None:
        step = self._steps[self._selected]
        if step.status == StepStatus.CONFIRM:
            step.status = StepStatus.PASSED
            self._advance_after_complete()
            self.redraw_ui()

    def confirm_fail(self) -> None:
        step = self._steps[self._selected]
        if step.status == StepStatus.CONFIRM:
            step.status = StepStatus.FAILED
            self._run_all_mode = False
            self._advance_after_complete()
            self.redraw_ui()

    def skip_selected(self) -> None:
        step = self._steps[self._selected]
        if step.status in (StepStatus.PENDING, StepStatus.CONFIRM):
            step.status = StepStatus.SKIPPED
            self._advance_after_complete()
            self.redraw_ui()

    def reset_all(self) -> None:
        self._run_all_mode = False
        self._run_request = None
        for step in self._steps:
            step.status = StepStatus.PENDING
            step.message = ""
            step.duration = None
        self._selected = 0
        self.redraw_ui()

    def _advance_after_complete(self) -> None:
        """Move selection to next step; trigger next run in run-all mode."""
        if self._selected < len(self._steps) - 1:
            self._selected += 1
            if self._run_all_mode:
                self._run_request = self._selected

    # ── Background task (runs in PluginMixin thread) ──────────────────

    def _background_task(self) -> bool:
        if self._run_request is None:
            return False

        idx = self._run_request
        self._run_request = None

        if idx < 0 or idx >= len(self._steps):
            return False

        step = self._steps[idx]
        step.status = StepStatus.RUNNING
        step.message = ""
        step.duration = None
        # Force a redraw so the RUNNING state shows immediately.
        get_pw_console_app().redraw_ui()

        start = time.monotonic()
        try:
            self._execute_step(idx, step)
        except Exception as exc:
            step.status = StepStatus.FAILED
            step.message = str(exc)
            _LOG.error("Step %d (%s) failed: %s", idx, step.name, exc)
            self._run_all_mode = False

        elapsed = time.monotonic() - start
        step.duration = elapsed

        # For auto steps that succeeded, advance
        if step.status == StepStatus.PASSED:
            self._advance_after_complete()

        return True

    def _execute_step(self, idx: int, step: TestStep) -> None:
        """Run the RPC for a given step. Called from background thread."""
        rpcs = self._device.rpcs
        factory = rpcs.maco.factory.FactoryTestService
        secrets = rpcs.maco.secrets.DeviceSecretsService

        if idx == 0:  # Echo Test
            resp = rpcs.maco.MacoService.Echo(data=b"hello")
            if resp.status.ok() and resp.response.data == b"hello":
                step.status = StepStatus.PASSED
                step.message = "Echo OK"
            else:
                step.status = StepStatus.FAILED
                step.message = "Echo mismatch"

        elif idx == 1:  # LED Red
            factory.LedSetAll(r=255, g=0, b=0, w=0)
            step.status = StepStatus.CONFIRM
            step.message = "Verify LEDs are RED"

        elif idx == 2:  # LED Green
            factory.LedSetAll(r=0, g=255, b=0, w=0)
            step.status = StepStatus.CONFIRM
            step.message = "Verify LEDs are GREEN"

        elif idx == 3:  # LED Blue
            factory.LedSetAll(r=0, g=0, b=255, w=0)
            step.status = StepStatus.CONFIRM
            step.message = "Verify LEDs are BLUE"

        elif idx == 4:  # LED White
            factory.LedSetAll(r=0, g=0, b=0, w=255)
            step.status = StepStatus.CONFIRM
            step.message = "Verify LEDs are WHITE"

        elif idx == 5:  # LED Clear
            factory.LedClear()
            step.status = StepStatus.PASSED
            step.message = "LEDs cleared"

        elif idx == 6:  # Display White
            factory.DisplayFillColor(r=255, g=255, b=255)
            step.status = StepStatus.CONFIRM
            step.message = "Verify display is WHITE"

        elif idx == 7:  # Display Color Bars
            factory.DisplayColorBars()
            step.status = StepStatus.CONFIRM
            step.message = "Verify color bars on display"

        elif idx == 8:  # Check Secrets
            resp = secrets.GetStatus()
            provisioned = resp.response.is_provisioned
            step.status = StepStatus.PASSED
            step.message = (
                "PROVISIONED" if provisioned else "NOT PROVISIONED"
            )

        elif idx == 9:  # Provision Secrets
            gw_hex = os.environ.get("FACTORY_GATEWAY_SECRET", "")
            ntag_hex = os.environ.get("FACTORY_NTAG_KEY", "")
            if not gw_hex or not ntag_hex:
                step.status = StepStatus.SKIPPED
                step.message = "Env vars not set"
                return
            gw_bytes = bytes.fromhex(gw_hex)
            ntag_bytes = bytes.fromhex(ntag_hex)
            if len(gw_bytes) != 16 or len(ntag_bytes) != 16:
                step.status = StepStatus.FAILED
                step.message = "Secrets must be 16 bytes"
                return
            resp = secrets.Provision(
                gateway_master_secret=gw_bytes,
                ntag_terminal_key=ntag_bytes,
            )
            if resp.response.success:
                step.status = StepStatus.PASSED
                step.message = "Provisioned"
            else:
                step.status = StepStatus.FAILED
                step.message = resp.response.error or "Provision failed"

        elif idx == 10:  # Verify Provisioned
            resp = secrets.GetStatus()
            if resp.response.is_provisioned:
                step.status = StepStatus.PASSED
                step.message = "Verified provisioned"
            else:
                step.status = StepStatus.FAILED
                step.message = "NOT provisioned"

    # ── Rendering ─────────────────────────────────────────────────────

    def _get_formatted_text(self) -> FormattedText:
        fragments: list[tuple[str, str]] = []
        nl = ("", "\n")

        done = sum(
            1
            for s in self._steps
            if s.status
            in (StepStatus.PASSED, StepStatus.FAILED, StepStatus.SKIPPED)
        )
        total = len(self._steps)

        # Header
        fragments.append(("class:theme-fg-cyan", f"  Factory Test ({done}/{total})"))
        fragments.append(nl)
        fragments.append(("class:theme-fg-dim", "  " + "\u2500" * 38))
        fragments.append(nl)

        for i, step in enumerate(self._steps):
            is_selected = i == self._selected

            # Selection indicator
            prefix = " > " if is_selected else "   "

            # Status icon
            icon, icon_style = self._status_icon(step.status)

            # Line style
            name_style = ""
            if is_selected:
                name_style = "class:theme-fg-active bold"
            elif step.status == StepStatus.PASSED:
                name_style = "class:theme-fg-green"
            elif step.status == StepStatus.FAILED:
                name_style = "class:theme-fg-red"
            elif step.status == StepStatus.SKIPPED:
                name_style = "class:theme-fg-dim"

            fragments.append(("", prefix))
            fragments.append((icon_style, f"[{icon}]"))
            fragments.append(("", " "))
            fragments.append((name_style, step.name))

            # Duration (right-aligned after name)
            if step.duration is not None:
                fragments.append(
                    ("class:theme-fg-dim", f"  {step.duration:.1f}s")
                )
            fragments.append(nl)

            # Status message on next line (indented)
            if step.message and step.status in (
                StepStatus.RUNNING,
                StepStatus.CONFIRM,
                StepStatus.FAILED,
            ):
                msg_style = "class:theme-fg-dim"
                if step.status == StepStatus.CONFIRM:
                    msg_style = "class:theme-fg-yellow"
                elif step.status == StepStatus.FAILED:
                    msg_style = "class:theme-fg-red"
                fragments.append(("", "       "))
                fragments.append((msg_style, step.message))
                fragments.append(nl)

        return FormattedText(fragments)

    @staticmethod
    def _status_icon(status: StepStatus) -> tuple[str, str]:
        match status:
            case StepStatus.PENDING:
                return " ", ""
            case StepStatus.RUNNING:
                return "~", "class:theme-fg-cyan"
            case StepStatus.CONFIRM:
                return "?", "class:theme-fg-yellow"
            case StepStatus.PASSED:
                return "\u2713", "class:theme-fg-green"
            case StepStatus.FAILED:
                return "\u2717", "class:theme-fg-red"
            case StepStatus.SKIPPED:
                return "-", "class:theme-fg-dim"

    def get_all_key_bindings(self) -> list:
        return [
            {
                "Run selected step": ["Enter"],
                "Run all remaining": ["a"],
                "Pass (visual confirm)": ["p"],
                "Fail (visual confirm)": ["f"],
                "Skip step": ["s"],
                "Reset all": ["r"],
                "Next step": ["j", "Down"],
                "Previous step": ["k", "Up"],
            }
        ]
