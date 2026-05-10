# Bootstrap (WSL Ubuntu 24.04)

End-to-end setup of a fresh WSL Ubuntu 24.04 instance for building and running
the machine-auth web apps + Firebase emulators, the MaCo firmware (host
simulator and P2 hardware), and the gateway.

> Verified on Ubuntu 24.04.4 LTS (Noble Numbat) under WSL2. macOS / native
> Linux paths are similar — adapt apt to your package manager and skip the
> WSL-specific sections (USB pass-through, port-proxy).

The order matters: each phase depends on the ones above it. Run them top to
bottom on a clean shell.

---

## 0. Prerequisites you bring

- Ubuntu 24.04 in WSL2, with `gh` CLI authenticated (`gh auth status`) and
  `git` available. (`gh` token must have at least `repo` scope so private
  repos clone; the project's standard token also has `read:org`, `gist`,
  `workflow`.)
- Access to the `werkstattwaedi/machine-auth` (public) and
  `werkstattwaedi/oww-maco-operations` (private) GitHub repos.
- Owner-level access to the GCP project `oww-maschinenfreigabe` if you need
  production secrets. (Not required for local dev.)

```bash
gh auth status                # confirm logged in
git --version                 # any modern git
```

**Sudo:** several phases need `sudo`. If you're running this from inside
an automated tool (or just want to avoid retyping your password), add a
temporary `NOPASSWD` rule and remove it once you're done:

```bash
echo "$USER ALL=(ALL) NOPASSWD: ALL" \
  | sudo tee /etc/sudoers.d/claude-bootstrap >/dev/null
sudo chmod 440 /etc/sudoers.d/claude-bootstrap
sudo visudo -c -f /etc/sudoers.d/claude-bootstrap   # must say "parsed OK"
# … run the rest of this guide …
sudo rm /etc/sudoers.d/claude-bootstrap             # revert when finished
```

---

## 1. APT prerequisites

```bash
sudo apt update
sudo apt install -y \
  build-essential ca-certificates curl wget git \
  libsdl2-dev \
  libpcsclite-dev pcscd \
  openjdk-21-jre-headless \
  python3-venv \
  usbutils
```

What each one is for:

| Package | Why |
|---|---|
| `build-essential` | C/C++ toolchain (gcc, make) — Bazel pulls headers from system |
| `libsdl2-dev` | Firmware host simulator (`bazel run //maco_firmware/apps/dev:simulator`) |
| `libpcsclite-dev`, `pcscd` | Direct PC/SC NFC reader access (host-side debugging) |
| `openjdk-21-jre-headless` | Firestore / Firebase emulator runs on the JVM |
| `python3-venv` | Pigweed + scripts occasionally provision their own venvs |
| `usbutils` | `lsusb` for diagnosing USB pass-through to WSL |

---

## 2. Node.js 22 via nvm

The repo pins `v22.14.0` in `.nvmrc`, and `functions/package.json` requires
Node 22 in `engines`. Use `nvm` so you can keep multiple versions side by
side.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Reload your shell or source the new lines in ~/.zshrc / ~/.bashrc:
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

nvm install 22
nvm alias default 22
node -v       # -> v22.x
```

**WSL gotcha:** if anything (a systemd service, a sudo invocation) needs
`node` on the global PATH, symlink it:

```bash
sudo ln -sf "$(which node)" /usr/local/bin/node
```

---

## 3. Go + Bazelisk + buildifier/buildozer

Bazel is launched through `bazelisk`, which downloads the right Bazel
version per workspace. Building it from source via Go also gives you
`buildifier`/`buildozer` for editing `BUILD.bazel` files.

```bash
sudo add-apt-repository -y ppa:longsleep/golang-backports
sudo apt update
sudo apt install -y golang-go

go install github.com/bazelbuild/bazelisk@latest
go install github.com/bazelbuild/buildtools/buildifier@latest
go install github.com/bazelbuild/buildtools/buildozer@latest

# Ensure ~/go/bin is on PATH (Go default GOPATH=~/go):
echo 'export PATH="$HOME/go/bin:$PATH"' >> ~/.zshrc
export PATH="$HOME/go/bin:$PATH"

# `npm run dev:gateway` and other scripts call `bazel`, not `bazelisk`.
# Symlink so both names resolve to bazelisk:
ln -sf "$HOME/go/bin/bazelisk" "$HOME/go/bin/bazel"

bazelisk version    # downloads/caches Bazel on first run (Bazel 8.6.0 as of writing)
```

Alternative (simpler, no Go): `npm install -g @bazel/bazelisk` — also creates
both `bazel` and `bazelisk` shims.

---

## 4. Global npm tooling

After Node 22 is active:

```bash
npm install -g firebase-tools
npm install -g particle-cli
```

`firebase-tools` runs the Firebase emulator suite, deploys functions/hosting,
and manages secrets. `particle-cli` flashes Particle device-OS firmware,
manages product enrollment, and serial-console access on hardware.

---

## 5. gcloud SDK (optional — required for production secrets)

Only needed if you'll factory-flash with `--prod`, fetch the gateway ASCON
key, or deploy from this machine.

```bash
# Per https://cloud.google.com/sdk/docs/install (Debian/Ubuntu instructions)
sudo apt install -y apt-transport-https
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
  | sudo gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
  | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list
sudo apt update
sudo apt install -y google-cloud-cli

gcloud auth login
gcloud config set project oww-maschinenfreigabe
gcloud auth application-default login
```

---

## 6. Clone repos

The operations repo must be a sibling of `machine-auth` —
`scripts/generate-env.ts` resolves `../machine-auth-operations` by default
(override with `OPERATIONS_CONFIG_DIR`).

The actual operations repo is `werkstattwaedi/oww-maco-operations` (private);
clone it under the expected directory name to keep the default resolution
working:

```bash
mkdir -p ~/werkstattwaedi
cd ~/werkstattwaedi

gh repo clone werkstattwaedi/machine-auth
gh repo clone werkstattwaedi/oww-maco-operations machine-auth-operations

cd machine-auth
git submodule update --init --recursive
```

Submodule list (per `.gitmodules`): `third_party/pigweed`, `third_party/sdl`,
`third_party/etl`, `third_party/lvgl/lvgl`,
`third_party/particle/third_party/device-os`,
`third_party/particle/third_party/docs`. The recursive init pulls in roughly
22 nested submodules (FreeRTOS, lwIP, mbedtls, ambd_sdk, etc. transitively
via device-os). Expect a few minutes and several hundred MB on a fresh
clone.

---

## 7. Install workspace dependencies + generate env files

From `~/werkstattwaedi/machine-auth`:

```bash
npm install                          # root deps (concurrently, tsx, husky)
(cd functions && npm install)        # cloud functions
(cd web && npm install)              # web workspaces (checkout + admin + modules)

npm run generate-env                 # reads ../machine-auth-operations/config*.jsonc
```

`generate-env` materializes (all gitignored):

- `functions/.env.local`, `functions/.env.<projectId>`
- `web/apps/checkout/.env.development`, `.env.production`
- `web/apps/admin/.env.development`, `.env.production`
- `maco_gateway/.env.local`
- `scripts/.env`
- `.firebaserc`

If this step fails, check that the operations repo has `config.jsonc` and
`config.local.jsonc` populated — see its README.

---

## 8. Particle udev rule (P2 hardware only)

Without this rule, Particle devices appear as `/dev/ttyACM0`/`ttyACM1` and
the number changes per plug-in. The `./pw console` and `./pw factory-console`
commands look for `/dev/particle_*` symlinks.

```bash
sudo tee /etc/udev/rules.d/99-particle.rules <<'EOF'
# Particle devices - create symlink with last 4 digits of serial
# e.g., serial 0a10aced202194944a042f04 -> /dev/particle_2f04
SUBSYSTEM=="tty", ATTRS{idVendor}=="2b04", PROGRAM="/bin/sh -c 'echo $attr{serial} | tail -c 5'", SYMLINK+="particle_%c", MODE="0666"
EOF

sudo udevadm control --reload-rules
sudo udevadm trigger
```

Verify after plugging in a device (and pass-through via `usbipd`, see next
section):

```bash
ls -la /dev/particle_*
```

---

## 9. WSL2 USB pass-through (P2 hardware only)

Particle devices live on the Windows host and must be attached into WSL2.

**On Windows (PowerShell as admin):**

```powershell
winget install --interactive --exact dorssel.usbipd-win
# Plug in the Particle device, then:
usbipd list                       # find the BUSID, e.g. 4-4
usbipd bind --busid 4-4           # one-time per device
usbipd attach --wsl --busid 4-4   # attach into the running WSL distro
```

**On WSL:**

```bash
lsusb                             # should show "Particle Industries"
ls /dev/particle_*                # udev rule creates the symlink
particle usb list                 # particle-cli sees the device
```

GUI alternative: <https://gitlab.com/alelec/wsl-usb-gui/-/releases>. Microsoft
docs: <https://learn.microsoft.com/en-us/windows/wsl/connect-usb>.

---

## 10. WSL2 port-proxy for the gateway (optional)

The gateway listens on `localhost:5000` inside WSL. To reach it from the
Windows host or LAN, add a port-proxy.

**Windows (PowerShell as admin):**

```powershell
$wslip = (wsl hostname -I).Trim().Split()[0]
netsh interface portproxy add v4tov4 listenport=5000 listenaddress=0.0.0.0 connectport=5000 connectaddress=$wslip
netsh advfirewall firewall add rule name="MACO Gateway" dir=in action=allow protocol=tcp localport=5000
netsh interface portproxy show all
```

WSL2 IPs change per restart; rerun the first three lines after each WSL
reboot, or script it.

---

## 11. PCSC polkit rule (optional — host-side NFC debugging)

Allows non-root local users to talk to PC/SC readers.

```bash
sudo tee /etc/polkit-1/rules.d/50-pcsc.rules <<'EOF'
polkit.addRule(function(action, subject) {
    if (action.id == "org.debian.pcsc-lite.access_pcsc" ||
        action.id == "org.debian.pcsc-lite.access_card") {
        return polkit.Result.YES;
    }
});
EOF

sudo systemctl restart polkit
sudo systemctl restart pcscd
```

---

## 12. Smoke tests

Run these in order. Each one warms a different toolchain.

```bash
cd ~/werkstattwaedi/machine-auth

# (a) Firebase emulator (Java + firebase-tools)
firebase emulators:start --only firestore --project=oww-maco
# Ctrl+C once you see "All emulators ready"

# (b) MaCo simulator (Bazelisk + SDL2 + Pigweed)
bazel build //maco_firmware/apps/dev:simulator
# First build pulls Pigweed, Particle device-os toolchain, etc — 1-3 min

# (c) Gateway (Bazel + rules_python toolchain)
npm run dev:gateway
# Should log: "MACO Gateway listening on ('0.0.0.0', 5000)" — Ctrl+C

# (d) Web + functions wired together
./dev.sh
# Browse: http://localhost:4000  (emulator UI)
#         https://localhost:5173 (checkout)
#         https://localhost:5174 (admin)
```

**Port conflicts on WSL2:** WSL2's localhost-forwarding feature surfaces
ports already bound on the Windows host (or another WSL distro) inside
your distro. If `firebase emulators:start` reports
`Port 4000 is not open on 127.0.0.1`, another emulator is already running
elsewhere — check Windows / other distros, or temporarily run with a
custom config that picks free ports (`--config /tmp/fb-alt.json` with
`emulators.{ui,firestore,hub,logging}.port` overrides).

For automated test runs that need to share a machine without colliding,
use the port-block broker — see [`docs/port-blocks.md`](port-blocks.md).
Manual dev (`./dev.sh`) keeps the default ports; only emulator-exec test
paths route through the broker.

---

## Troubleshooting

- **`firebase emulators:start` reports `Port 4000 is not open on 127.0.0.1`** —
  almost always another emulator already running on the Windows host or in
  another WSL distro (WSL2 transparently shares localhost). Check
  `ss -tln | grep -E ':(4000|5001|8080|9099)'`; either kill the offender
  or pass `--config` with override ports for `ui/firestore/hub/logging`.
- **`firebase emulators:start` complains about Java** — confirm
  `java -version` resolves; reinstall `openjdk-21-jre-headless`.
- **`sh: 1: bazel: not found` from `npm run dev:gateway`** — `~/go/bin/bazel`
  symlink missing. The Go-installed binary is named `bazelisk`, but the npm
  script invokes `bazel`:

  ```bash
  ln -sf "$HOME/go/bin/bazelisk" "$HOME/go/bin/bazel"
  ```

- **`bazelisk: command not found`** — `~/go/bin` not on PATH. Re-source
  your shell rc, or run `export PATH="$HOME/go/bin:$PATH"`.
- **`npm run generate-env` fails with "config.jsonc not found"** — sibling
  layout broken. Confirm `ls ../machine-auth-operations/config.jsonc`. Note
  the operations repo on GitHub is named `oww-maco-operations`; clone it
  *as* `machine-auth-operations` to satisfy the default path.
- **`/dev/particle_*` not appearing after `usbipd attach`** — udev rule
  missing or device not Particle. Check `lsusb` for vendor `2b04` and
  `ls /dev/ttyACM*`.
- **`./dev.sh` fails first run** — almost always env files missing. Run
  `npm run generate-env` and re-check the operations repo.

---

## What this leaves you with

- `node -v` → v22.x
- `bazelisk version` → Bazel from MODULE.bazel
- `firebase --version`, `particle --version`, `gh --version` → all available
- `~/werkstattwaedi/machine-auth` and `…-operations` cloned and synced
- All `.env.*` files materialized
- `/dev/particle_*` symlink on USB attach (WSL P2 hardware)

Production deployment (functions, hosting, secrets) is covered in
[`config.md`](config.md) and [`deployment-checklist.md`](deployment-checklist.md).
