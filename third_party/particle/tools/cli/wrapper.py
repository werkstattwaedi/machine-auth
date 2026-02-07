# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Hermetic Particle CLI wrapper with retry logic and error handling.

Provides a Python interface to particle-cli via Bazel-provided npm package
or system-installed CLI as fallback.
"""

import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

_LOG = logging.getLogger(__name__)

# ANSI escape code pattern for stripping terminal formatting
_ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]|\[[0-9;]*[a-zA-Z]")


class ParticleCliError(Exception):
    """Raised when a particle-cli command fails."""

    def __init__(self, message: str, returncode: int = 1, output: str = ""):
        super().__init__(message)
        self.returncode = returncode
        self.output = output


@dataclass
class CliResult:
    """Result of a particle-cli command."""

    stdout: str
    stderr: str
    returncode: int

    @property
    def success(self) -> bool:
        return self.returncode == 0

    @property
    def output(self) -> str:
        """Combined and cleaned output."""
        return strip_ansi(self.stdout + self.stderr)


def strip_ansi(text: str) -> str:
    """Strip ANSI escape codes from text."""
    return _ANSI_ESCAPE.sub("", text)


class ParticleCli:
    """Wrapper for particle-cli with hermetic Bazel integration.

    Can use particle-cli from:
    1. Bazel runfiles (hermetic npm package)
    2. Explicit path
    3. System PATH (fallback)

    Usage:
        cli = ParticleCli()
        result = cli.run(["flash", "--local", "firmware.bin"])

        # With retry for flaky commands
        result = cli.run_with_retry(
            ["usb", "cloud-status", "my-device"],
            max_retries=3,
            retry_delay=2.0,
        )
    """

    def __init__(
        self,
        particle_path: Optional[str] = None,
        runfiles_dir: Optional[str] = None,
    ):
        """Initialize the CLI wrapper.

        Args:
            particle_path: Explicit path to particle executable.
            runfiles_dir: Bazel runfiles directory for hermetic CLI.
        """
        self._particle_path = self._resolve_particle_path(
            particle_path, runfiles_dir
        )
        _LOG.debug("Using particle-cli at: %s", self._particle_path)

    def _resolve_particle_path(
        self,
        explicit_path: Optional[str],
        runfiles_dir: Optional[str],
    ) -> str:
        """Resolve the path to particle-cli executable."""
        # 1. Explicit path takes priority
        if explicit_path:
            if os.path.isfile(explicit_path):
                return explicit_path
            raise ParticleCliError(f"Particle CLI not found at: {explicit_path}")

        # 2. Try Bazel runfiles (hermetic npm package)
        runfiles = runfiles_dir or os.environ.get("RUNFILES_DIR")
        if runfiles:
            # Try multiple possible locations depending on module context
            candidate_paths = [
                # When running from within particle_bazel module
                os.path.join(
                    runfiles,
                    "npm_particle_cli",
                    "node_modules",
                    ".bin",
                    "particle",
                ),
                # When running from main module (particle_bazel as dependency)
                os.path.join(
                    runfiles,
                    "particle_bazel+",
                    "tools",
                    "node_modules",
                    ".bin",
                    "particle",
                ),
            ]
            for hermetic_path in candidate_paths:
                if os.path.isfile(hermetic_path):
                    return hermetic_path
                _LOG.debug("particle-cli not found at: %s", hermetic_path)

        # 3. Fall back to system PATH
        system_path = shutil.which("particle")
        if system_path:
            _LOG.info("Using system particle-cli at: %s", system_path)
            return system_path

        raise ParticleCliError(
            "particle-cli not found. Install via: npm install -g particle-cli"
        )

    @property
    def path(self) -> str:
        """Path to the particle executable."""
        return self._particle_path

    def run(
        self,
        args: list[str],
        timeout: float = 60.0,
        capture_output: bool = True,
        check: bool = False,
    ) -> CliResult:
        """Run a particle-cli command.

        Args:
            args: Command arguments (without 'particle' prefix).
            timeout: Command timeout in seconds.
            capture_output: Whether to capture stdout/stderr.
            check: If True, raise ParticleCliError on non-zero exit.

        Returns:
            CliResult with command output.

        Raises:
            ParticleCliError: If check=True and command fails, or timeout.
        """
        cmd = [self._particle_path] + args
        _LOG.info("Running: %s", " ".join(cmd))

        # Ensure HOME is set for particle-cli's settings.js
        # Without HOME, particle-cli tries to create .particle in its package dir
        env = os.environ.copy()
        if "HOME" not in env:
            import tempfile

            env["HOME"] = tempfile.gettempdir()

        try:
            result = subprocess.run(
                cmd,
                capture_output=capture_output,
                text=True,
                timeout=timeout,
                env=env,
            )
            cli_result = CliResult(
                stdout=result.stdout or "",
                stderr=result.stderr or "",
                returncode=result.returncode,
            )

            if check and not cli_result.success:
                raise ParticleCliError(
                    f"Command failed: {' '.join(args)}\n{cli_result.output}",
                    returncode=cli_result.returncode,
                    output=cli_result.output,
                )

            return cli_result

        except subprocess.TimeoutExpired as e:
            raise ParticleCliError(
                f"Command timed out after {timeout}s: {' '.join(args)}"
            ) from e

    def run_with_retry(
        self,
        args: list[str],
        max_retries: int = 3,
        retry_delay: float = 2.0,
        backoff_factor: float = 1.5,
        timeout: float = 60.0,
    ) -> CliResult:
        """Run a particle-cli command with exponential backoff retry.

        Args:
            args: Command arguments (without 'particle' prefix).
            max_retries: Maximum number of retry attempts.
            retry_delay: Initial delay between retries in seconds.
            backoff_factor: Multiplier for delay after each retry.
            timeout: Command timeout in seconds.

        Returns:
            CliResult with command output.

        Raises:
            ParticleCliError: If all retries fail.
        """
        last_error: Optional[ParticleCliError] = None
        delay = retry_delay

        for attempt in range(max_retries + 1):
            try:
                return self.run(args, timeout=timeout, check=True)
            except ParticleCliError as e:
                last_error = e
                if attempt < max_retries:
                    _LOG.warning(
                        "Attempt %d/%d failed: %s. Retrying in %.1fs...",
                        attempt + 1,
                        max_retries + 1,
                        str(e),
                        delay,
                    )
                    time.sleep(delay)
                    delay *= backoff_factor

        assert last_error is not None
        raise last_error

    # -- Convenience Methods --

    def flash_local(
        self,
        firmware_path: str,
        timeout: float = 120.0,
    ) -> CliResult:
        """Flash firmware to a locally connected device via USB.

        Args:
            firmware_path: Path to firmware binary (.bin).
            timeout: Flash timeout in seconds.

        Returns:
            CliResult with flash output.
        """
        return self.run(
            ["flash", "--local", firmware_path],
            timeout=timeout,
            check=True,
        )

    def usb_reset(self, device: Optional[str] = None) -> CliResult:
        """Reset a USB-connected device.

        Args:
            device: Optional device name or ID. If None, resets first device.

        Returns:
            CliResult with reset output.
        """
        args = ["usb", "reset"]
        if device:
            args.append(device)
        return self.run(args, timeout=30.0, check=True)

    def usb_cloud_status(self, device: str, timeout: float = 10.0) -> str:
        """Get cloud connection status of a USB-connected device.

        Args:
            device: Device name or ID.
            timeout: Command timeout in seconds.

        Returns:
            Status string: "connected", "connecting", "disconnected", etc.
        """
        result = self.run(
            ["usb", "cloud-status", device],
            timeout=timeout,
            check=True,
        )

        output = strip_ansi(result.stdout.strip())
        if ":" in output:
            return output.split(":")[-1].strip().lower()
        return output.strip().lower()

    def usb_dfu(self, device: Optional[str] = None) -> CliResult:
        """Put device into DFU mode.

        Args:
            device: Optional device name or ID.

        Returns:
            CliResult with command output.
        """
        args = ["usb", "dfu"]
        if device:
            args.append(device)
        return self.run(args, timeout=30.0, check=True)

    def serial_list(self) -> list[str]:
        """List serial ports with Particle devices.

        Returns:
            List of serial port paths (e.g., ["/dev/ttyACM0"]).
        """
        result = self.run(["serial", "list"], timeout=10.0)

        ports = []
        for line in result.stdout.splitlines():
            line = strip_ansi(line.strip())
            # Look for lines containing ttyACM or ttyUSB
            if "ttyACM" in line or "ttyUSB" in line:
                # Extract port path
                for word in line.split():
                    if word.startswith("/dev/tty"):
                        ports.append(word)
                        break
        return ports

    def call_function(
        self,
        device: str,
        function_name: str,
        argument: str = "",
        timeout: float = 30.0,
    ) -> int:
        """Call a cloud function on a device.

        Args:
            device: Device name or ID.
            function_name: Name of the function.
            argument: String argument to pass.
            timeout: Command timeout in seconds.

        Returns:
            Integer return value from the function.

        Raises:
            ParticleCliError: If call fails or return value can't be parsed.
        """
        result = self.run(
            ["call", device, function_name, argument],
            timeout=timeout,
            check=True,
        )

        try:
            return int(result.stdout.strip())
        except ValueError as e:
            raise ParticleCliError(
                f"Failed to parse function return value: {result.stdout}"
            ) from e

    def get_variable(
        self,
        device: str,
        variable_name: str,
        timeout: float = 30.0,
    ) -> str:
        """Get a cloud variable from a device.

        Args:
            device: Device name or ID.
            variable_name: Name of the variable.
            timeout: Command timeout in seconds.

        Returns:
            String value of the variable.
        """
        result = self.run(
            ["get", device, variable_name],
            timeout=timeout,
            check=True,
        )
        return result.stdout.strip()

    def publish_event(
        self,
        event_name: str,
        data: str = "",
        private: bool = True,
        timeout: float = 30.0,
    ) -> CliResult:
        """Publish a cloud event.

        Args:
            event_name: Event name to publish.
            data: Event data payload.
            private: If True, publish as private event.
            timeout: Command timeout in seconds.

        Returns:
            CliResult with publish output.
        """
        args = ["publish", event_name, data]
        if private:
            args.append("--private")
        return self.run(args, timeout=timeout, check=True)
