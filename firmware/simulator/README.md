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
- **7** - Top-Left Button
- **9** - Top-Right Button
- **1** - Bottom-Left Button
- **3** - Bottom-Right Button

**Other Keys:**
- **S** - Simulate NFC Tag
- **M** - Menu (not yet implemented)
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

## Next Steps

- [ ] Port existing UI components from `firmware/src/ui/`
- [ ] Create mock Application state for testing
- [ ] Implement screen transitions
- [ ] Add LED pattern testing
- [ ] Build missing UI screens from mockups
