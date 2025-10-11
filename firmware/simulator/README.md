# Machine Auth UI Simulator

Fast iteration UI development environment using LVGL + SDL2.

## Quick Start

### Install Dependencies

```bash
# Ubuntu/Debian
sudo apt-get install libsdl2-dev cmake build-essential

# macOS
brew install sdl2 cmake

# Fedora
sudo dnf install SDL2-devel cmake gcc-c++
```

### Build and Run

```bash
cd firmware/simulator
cmake -B build -S .
cmake --build build
./build/simulator
```

## Keyboard Controls

**Numpad (matches physical button layout):**
- **Numpad 7** - Top-Left Button
- **Numpad 9** - Top-Right Button
- **Numpad 1** - Bottom-Left Button
- **Numpad 3** - Bottom-Right Button

**State Control:**
- **1** - Return to Idle state
- **2** - Trigger Active Session (user logged in, machine running)
- **3** - Trigger Denied state (access denied)
- **C** - Cycle through Session states (Idle → WaitingForTag → Authenticating → Active → Rejected → Idle)
- **M** - Cycle through Machine states (Idle → Active → Denied → Idle)
- **B** - Complete boot sequence

**Other Keys:**
- **S** - Simulate NFC Tag
- **ESC** - Quit

## Features

- **240x320 display** - Matches hardware exactly
- **16 RGB LED ring** - Visualized as colored circles around display
- **4 button LEDs** - Shown below display with keyboard mapping
- **2 NFC LEDs** - Visualized at bottom
- **Buzzer feedback** - Printed to console

## Development Workflow

1. Edit UI code in `firmware/src/ui/`
2. Rebuild simulator: `cmake --build build`
3. Run and test: `./build/simulator`
4. Iterate rapidly (<1 second compile time)
5. When satisfied, flash to hardware

## Architecture

- **HAL Interface** (`hal/hardware_interface.h`) - Hardware abstraction
- **Simulator Hardware** (`hal/simulator_hardware.cpp`) - SDL-based implementation
- **Main Loop** (`main.cpp`) - LVGL + SDL integration

Both firmware and simulator implement the same HAL interface, allowing UI code to run identically on both platforms.

## Mock Application State

The simulator includes a `MockApplication` class (`mock/mock_application.h/cpp`) that provides testable application states:

**Session States:**
- Idle - No activity
- WaitingForTag - Ready for NFC tag
- AuthenticatingTag - Tag detected, authenticating
- SessionActive - User logged in with active session
- Rejected - Access denied / unknown tag

**Machine States:**
- Idle - Machine off
- Active - Machine running with active user session
- Denied - Access denied (insufficient permissions)

Use keyboard shortcuts (1-3, C, M) to cycle through states and test UI behavior.

## Next Steps

- [x] Create mock Application state for testing
- [ ] Extract state abstraction layer to `src/state/`
- [ ] Move hardware drivers out of UI to `src/drivers/`
- [ ] Split UI into reusable core and platform-specific code
- [ ] Port UI components to use shared state interface
- [ ] Build missing UI screens from mockups
