
#include "setup/setup.h"

#include <vector>

#include "ui/driver/display.h"
#include "ui/leds/led_controller.h"

namespace oww::setup {

std::shared_ptr<oww::app::Application> app_;
std::unique_ptr<Adafruit_NeoPixel> led_strip_;
std::unique_ptr<oww::ui::leds::LedController> led_;
using namespace config::ext;

int SetLed(String command);
int SetLedFx(String command);
int SetRelais(String command) {
  if (command == "on") {
    digitalWrite(pin_relais, HIGH);
    pinMode(pin_relais, OUTPUT);
    digitalWrite(pin_relais, HIGH);
    delay(1000);
    pinMode(pin_relais, INPUT);
    return 0;  // Success
  } else if (command == "off") {
    digitalWrite(pin_relais, HIGH);
    pinMode(pin_relais, OUTPUT);
    digitalWrite(pin_relais, LOW);
    delay(1000);
    pinMode(pin_relais, INPUT);
    return 0;  // Success
  } else {
    return -1;  // Invalid command
  }
}

String relaisState() {
  int state = digitalRead(pin_relais);
  return String(state == HIGH ? "on" : "off");
}

void setup(std::shared_ptr<oww::app::Application> state) {
  Particle.function("led", SetLed);
  Particle.function("ledfx", SetLedFx);  // high-level LED test interface
  Particle.function("relais", SetRelais);
  Particle.variable("relaisState", relaisState);

  pinMode(pin_relais, INPUT);

  app_ = state;
  led_strip_ = std::make_unique<Adafruit_NeoPixel>(
      config::led::pixel_count, SPI, config::led::pixel_type);

  led_strip_->show();

  // High-level LED controller for quick testing
  led_ = std::make_unique<oww::ui::leds::LedController>(led_strip_.get());
  led_->InitializeDefaultMapping();

  // Initialize display
  Status display_status = Display::instance().Begin();
  if (display_status != Status::kOk) {
    Log.error("Failed to initialize display: %d", (int)display_status);
  } else {
    Log.info("Display initialized successfully");

    lv_obj_t* label = lv_label_create(lv_screen_active());
    lv_label_set_text(label, "OWW MACO TEST");
    lv_obj_align(label, LV_ALIGN_TOP_MID, 0, 0);
  }
}

void loop() {
  Display::instance().RenderLoop();
  if (led_) led_->Tick(millis());
}

int SetLed(String command) {
  // Parse comma-separated values: led_number,r,g,b,w
  int values[5];
  int value_count = 0;

  // Split the command string by commas
  unsigned int start = 0;
  for (unsigned int i = 0; i <= command.length() && value_count < 5; i++) {
    if (i == command.length() || command.charAt(i) == ',') {
      if (i == start) {
        // Empty value
        return -1;
      }

      String value_str = command.substring(start, i);
      value_str.trim();

      // Convert to integer
      char* endptr;
      long value = strtol(value_str.c_str(), &endptr, 10);

      // Check if conversion was successful and value is in valid range
      if (*endptr != '\0' || value < 0 || value > 255) {
        return -1;
      }

      values[value_count] = (int)value;
      value_count++;
      start = i + 1;
    }
  }

  // We need exactly 5 values: led_number, r, g, b, w
  if (value_count != 5) {
    return -1;
  }

  int led_number = values[0];
  int r = values[1];
  int g = values[2];
  int b = values[3];
  int w = values[4];

  // Validate LED number is within range
  if (led_number >= oww::setup::led_strip_->numPixels()) {
    return -1;
  }

  // Set the pixel color and update the strip
  oww::setup::led_strip_->setPixelColor(led_number, r, g, b, w);
  oww::setup::led_strip_->show();

  return 0;
}

// ---- High level LED test interface ---------------------------------------
//
// Particle.function("ledfx", SetLedFx)
//
// Purpose
//   Drive the LED controller in setup mode without the full UI. This lets you
//   exercise ring, buttons, and NFC effects, tune speeds and sizes, and try
//   common presets.
//
// Grammar
//   - Presets
//       "preset:NAME"
//     where NAME is one of: idle, detected, auth, start, denied, dev
//
//   - Section + Effect
//       "SECTION:EFFECT:PARAMS"
//     where SECTION is: ring | buttons | nfc
//
// Colors
//   All effects take RGBA(W) color first: r,g,b,w in 0..255.
//   The white channel is useful with the diffuser for soft backgrounds.
//
// Effects and parameters
//   1) off
//      - No parameters. Turns the section off.
//      Example: "ring:off"
//
//   2) solid
//      - Params: r,g,b,w
//      Example: "nfc:solid:0,0,0,24"
//
//   3) breathe
//      - Params: r,g,b,w[,period_ms[,minB[,maxB]]]
//        period_ms: full breathe cycle time (default 2000)
//        minB/maxB: brightness scaling 0..255 (defaults 8/96)
//      Example: "ring:breathe:0,64,200,0,3000,8,64"
//
//   4) blink
//      - Params: r,g,b,w[,period_ms[,duty0..255]]
//        duty: on proportion of the period (127 ~= 50%)
//      Example: "buttons:blink:120,20,20,0,700,160"
//
//   5) rotate (ring only meaningful)
//      - Smooth cosine lobe(s) move around the ring using physical spacing.
//      - Params: r,g,b,w[,period_ms[,lobe_tenths[,hotspots[,direction]]]]
//        period_ms: time for a full revolution (default 1500)
//        lobe_tenths: hotspot width in tenths of a nominal pixel span
//                     (10 ≈ one pixel, 5 ≈ half, 20 ≈ double; default 10)
//        hotspots: number of evenly spaced hotspots (default 1)
//        direction: +1 clockwise, -1 counter-clockwise (default +1)
//      Examples:
//        "ring:rotate:200,160,20,0,1500,10,2"     // two opposite hotspots
//        "ring:rotate:10,180,180,0,1200,8,2,-1"  // reverse, narrower
//
// Notes
//   - Buttons section currently applies the same effect to all four buttons
//     but the UI can set different per-button colors.
//   - Ring physical spacing is baked into the controller so the hotspot flows
//     naturally around tighter top pixels and wider sides.
//   - You can combine section calls, e.g., set ring rotate and nfc breathe.
//
// Return values
//   0 on success, -1 on parse/validation errors.

using namespace oww::ui::leds;

static bool parseRGBA(const String &params, Color &c,
                      uint16_t *p0 = nullptr, uint8_t *p1 = nullptr,
                      uint8_t *p2 = nullptr, int8_t *p3 = nullptr) {
  // Accept forms: r,g,b,w[,p0[,p1[,p2[,p3]]]]
  std::vector<int> vals;
  vals.reserve(8);
  unsigned int start = 0;
  for (unsigned int i = 0; i <= params.length(); ++i) {
    if (i == params.length() || params.charAt(i) == ',') {
      if (i == start) return false;
      char *endptr;
      long v = strtol(params.substring(start, i).c_str(), &endptr, 10);
      if (*endptr != '\0') return false;
      vals.push_back((int)v);
      start = i + 1;
    }
  }
  if (vals.size() < 4) return false;
  c = Color::RGB(vals[0], vals[1], vals[2], vals[3]);
  size_t idx = 4;
  if (p0 && idx < vals.size()) *p0 = (uint16_t)vals[idx++];
  if (p1 && idx < vals.size()) *p1 = (uint8_t)vals[idx++];
  if (p2 && idx < vals.size()) *p2 = (uint8_t)vals[idx++];
  if (p3 && idx < vals.size()) *p3 = (int8_t)vals[idx++];
  return true;
}

static void applyPreset(const String &name) {
  EffectConfig ring, buttons, nfc;
  ButtonColors btn_colors;
  if (name == "idle") {
    ring.type = EffectType::Breathe; ring.color = Color::RGB(0, 64, 200); ring.period_ms = 3000; ring.min_brightness = 8; ring.max_brightness = 64;
    nfc.type = EffectType::Solid; nfc.color = Color::WarmWhite(24);
    buttons.type = EffectType::Solid; btn_colors = {Color::RGB(32,32,32),Color::RGB(32,32,32),Color::RGB(32,32,32),Color::RGB(32,32,32)};
  } else if (name == "detected") {
    ring.type = EffectType::Rotate; ring.color = Color::RGB(200,160,20); ring.lit_pixels = 2; ring.period_ms = 1500;
    nfc.type = EffectType::Breathe; nfc.color = Color::RGB(0,80,220);
    buttons.type = EffectType::Solid; btn_colors = {Color::RGB(60,60,20),Color::RGB(60,60,20),Color::RGB(60,60,20),Color::RGB(60,60,20)};
  } else if (name == "auth") {
    ring.type = EffectType::Solid; ring.color = Color::RGB(0,180,40);
    nfc.type = EffectType::Breathe; nfc.color = Color::RGB(0,120,40);
    buttons.type = EffectType::Solid; btn_colors = {Color::RGB(40,120,40),Color::RGB(40,120,40),Color::RGB(40,120,40),Color::RGB(40,120,40)};
  } else if (name == "start") {
    ring.type = EffectType::Rotate; ring.color = Color::RGB(10,180,180); ring.period_ms = 1200; ring.lit_pixels = 1;
    nfc.type = EffectType::Solid; nfc.color = Color::RGB(0,60,60);
    buttons.type = EffectType::Blink; buttons.duty_cycle = 180;
    btn_colors = {Color::RGB(20,80,80),Color::RGB(20,80,80),Color::RGB(20,80,80),Color::RGB(20,80,80)};
  } else if (name == "denied") {
    ring.type = EffectType::Blink; ring.color = Color::RGB(200,20,20); ring.period_ms = 700; ring.duty_cycle = 160;
    nfc.type = EffectType::Solid; nfc.color = Color::RGB(120,0,0);
    buttons.type = EffectType::Solid; btn_colors = {Color::RGB(120,20,20),Color::RGB(120,20,20),Color::RGB(120,20,20),Color::RGB(120,20,20)};
  } else if (name == "dev") {
    ring.type = EffectType::Breathe; ring.color = Color::RGB(180,0,180); ring.period_ms = 2500;
    nfc.type = EffectType::Solid; nfc.color = Color::RGB(120,0,120);
    buttons.type = EffectType::Solid; btn_colors = {Color::RGB(80,0,80),Color::RGB(80,0,80),Color::RGB(80,0,80),Color::RGB(80,0,80)};
  } else {
    return;
  }
  led_->Ring().SetEffect(ring);
  led_->Buttons().SetEffect(buttons);
  led_->Buttons().SetColors(btn_colors);
  led_->Nfc().SetEffect(nfc);
}

int SetLedFx(String command) {
  if (!led_) return -1;
  int sep = command.indexOf(':');
  String section = sep >= 0 ? command.substring(0, sep) : command;
  String rest = sep >= 0 ? command.substring(sep + 1) : "";

  if (section == "preset") {
    applyPreset(rest);
    return 0;
  }

  int sep2 = rest.indexOf(':');
  String effect = sep2 >= 0 ? rest.substring(0, sep2) : rest;
  String params = sep2 >= 0 ? rest.substring(sep2 + 1) : "";

  EffectConfig cfg;
  Color c;

  if (effect == "off") {
    cfg.type = EffectType::Off;
  } else if (effect == "solid") {
    cfg.type = EffectType::Solid;
    if (!parseRGBA(params, c)) return -1;
    cfg.color = c;
  } else if (effect == "breathe") {
    cfg.type = EffectType::Breathe;
    uint16_t period = 2000; uint8_t minb = 8, maxb = 96;
    if (!parseRGBA(params, c, &period, &minb, &maxb)) return -1;
    cfg.color = c; cfg.period_ms = period; cfg.min_brightness = minb; cfg.max_brightness = maxb;
  } else if (effect == "blink") {
    cfg.type = EffectType::Blink;
    uint16_t period = 800; uint8_t duty = 127;
    if (!parseRGBA(params, c, &period, &duty)) return -1;
    cfg.color = c; cfg.period_ms = period; cfg.duty_cycle = duty;
  } else if (effect == "rotate") {
    cfg.type = EffectType::Rotate;
  uint16_t period = 1500; uint8_t lit = 10; uint8_t hotspots = 1; int8_t dir = 1;
    if (!parseRGBA(params, c, &period, &lit, &hotspots, &dir)) return -1;
    cfg.color = c; cfg.period_ms = period; cfg.lit_pixels = lit; cfg.hotspots = hotspots; cfg.direction = dir;
  } else {
    return -1;
  }

  if (section == "ring") {
    led_->Ring().SetEffect(cfg);
  } else if (section == "nfc") {
    led_->Nfc().SetEffect(cfg);
  } else if (section == "buttons") {
    led_->Buttons().SetEffect(cfg);
  } else {
    return -1;
  }
  return 0;
}

}  // namespace oww::setup
