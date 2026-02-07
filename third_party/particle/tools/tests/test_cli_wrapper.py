# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Unit tests for Particle CLI wrapper."""

import os
import subprocess
import unittest
from unittest.mock import MagicMock, patch

from tools.cli.wrapper import (
    CliResult,
    ParticleCli,
    ParticleCliError,
    strip_ansi,
)


class TestStripAnsi(unittest.TestCase):
    """Tests for ANSI escape code stripping."""

    def test_strip_basic(self):
        """Test stripping basic ANSI codes."""
        text = "\x1b[32mgreen\x1b[0m text"
        result = strip_ansi(text)
        self.assertEqual(result, "green text")

    def test_strip_multiple(self):
        """Test stripping multiple ANSI codes."""
        text = "\x1b[1m\x1b[31mBold Red\x1b[0m Normal"
        result = strip_ansi(text)
        self.assertEqual(result, "Bold Red Normal")

    def test_no_codes(self):
        """Test text without ANSI codes passes through."""
        text = "plain text"
        result = strip_ansi(text)
        self.assertEqual(result, "plain text")

    def test_bracket_codes(self):
        """Test stripping bracket-only codes (without escape)."""
        text = "[2K[1Gstatus: connected"
        result = strip_ansi(text)
        self.assertEqual(result, "status: connected")


class TestCliResult(unittest.TestCase):
    """Tests for CliResult dataclass."""

    def test_success_true(self):
        """Test success property with zero return code."""
        result = CliResult(stdout="ok", stderr="", returncode=0)
        self.assertTrue(result.success)

    def test_success_false(self):
        """Test success property with non-zero return code."""
        result = CliResult(stdout="", stderr="error", returncode=1)
        self.assertFalse(result.success)

    def test_output_combined(self):
        """Test output combines and strips ANSI."""
        result = CliResult(
            stdout="\x1b[32mout\x1b[0m",
            stderr="\x1b[31merr\x1b[0m",
            returncode=0,
        )
        self.assertEqual(result.output, "outerr")


class TestParticleCli(unittest.TestCase):
    """Tests for ParticleCli wrapper."""

    @patch("shutil.which")
    def test_init_system_fallback(self, mock_which):
        """Test fallback to system particle-cli."""
        mock_which.return_value = "/usr/local/bin/particle"
        cli = ParticleCli()
        self.assertEqual(cli.path, "/usr/local/bin/particle")

    @patch("shutil.which")
    def test_init_no_particle_raises(self, mock_which):
        """Test error when particle-cli not found."""
        mock_which.return_value = None
        with self.assertRaises(ParticleCliError) as ctx:
            ParticleCli()
        self.assertIn("not found", str(ctx.exception))

    def test_init_explicit_path(self):
        """Test initialization with explicit path."""
        with patch("os.path.isfile", return_value=True):
            cli = ParticleCli(particle_path="/custom/particle")
            self.assertEqual(cli.path, "/custom/particle")

    def test_init_explicit_path_not_found(self):
        """Test error when explicit path doesn't exist."""
        with patch("os.path.isfile", return_value=False):
            with self.assertRaises(ParticleCliError):
                ParticleCli(particle_path="/nonexistent/particle")

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_run_success(self, mock_run, mock_which):
        """Test successful command execution."""
        mock_which.return_value = "/usr/bin/particle"
        mock_run.return_value = MagicMock(
            stdout="success",
            stderr="",
            returncode=0,
        )

        cli = ParticleCli()
        result = cli.run(["version"])

        self.assertTrue(result.success)
        self.assertEqual(result.stdout, "success")
        mock_run.assert_called_once()

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_run_failure_check(self, mock_run, mock_which):
        """Test command failure with check=True."""
        mock_which.return_value = "/usr/bin/particle"
        mock_run.return_value = MagicMock(
            stdout="",
            stderr="error message",
            returncode=1,
        )

        cli = ParticleCli()
        with self.assertRaises(ParticleCliError) as ctx:
            cli.run(["bad-command"], check=True)

        self.assertIn("error message", str(ctx.exception))

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_run_timeout(self, mock_run, mock_which):
        """Test command timeout."""
        mock_which.return_value = "/usr/bin/particle"
        mock_run.side_effect = subprocess.TimeoutExpired("particle", 10)

        cli = ParticleCli()
        with self.assertRaises(ParticleCliError) as ctx:
            cli.run(["slow-command"], timeout=10)

        self.assertIn("timed out", str(ctx.exception))

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_usb_cloud_status(self, mock_run, mock_which):
        """Test USB cloud status parsing."""
        mock_which.return_value = "/usr/bin/particle"
        mock_run.return_value = MagicMock(
            stdout="[2K[1Gmy-device: connected\n",
            stderr="",
            returncode=0,
        )

        cli = ParticleCli()
        status = cli.usb_cloud_status("my-device")

        self.assertEqual(status, "connected")

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_call_function(self, mock_run, mock_which):
        """Test calling a cloud function."""
        mock_which.return_value = "/usr/bin/particle"
        mock_run.return_value = MagicMock(
            stdout="42",
            stderr="",
            returncode=0,
        )

        cli = ParticleCli()
        result = cli.call_function("my-device", "testFunc", "arg")

        self.assertEqual(result, 42)

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_call_function_parse_error(self, mock_run, mock_which):
        """Test function call with unparseable result."""
        mock_which.return_value = "/usr/bin/particle"
        mock_run.return_value = MagicMock(
            stdout="not a number",
            stderr="",
            returncode=0,
        )

        cli = ParticleCli()
        with self.assertRaises(ParticleCliError) as ctx:
            cli.call_function("my-device", "testFunc")

        self.assertIn("parse", str(ctx.exception).lower())

    @patch("shutil.which")
    @patch("subprocess.run")
    @patch("time.sleep")
    def test_run_with_retry(self, mock_sleep, mock_run, mock_which):
        """Test retry logic on failure."""
        mock_which.return_value = "/usr/bin/particle"

        # First two calls fail, third succeeds
        mock_run.side_effect = [
            MagicMock(stdout="", stderr="error", returncode=1),
            MagicMock(stdout="", stderr="error", returncode=1),
            MagicMock(stdout="success", stderr="", returncode=0),
        ]

        cli = ParticleCli()
        result = cli.run_with_retry(["flaky-command"], max_retries=3)

        self.assertTrue(result.success)
        self.assertEqual(mock_run.call_count, 3)
        self.assertEqual(mock_sleep.call_count, 2)


if __name__ == "__main__":
    unittest.main()
