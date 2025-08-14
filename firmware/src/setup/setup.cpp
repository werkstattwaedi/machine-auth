
#include "setup/setup.h"

#include "ui/driver/display.h"

namespace oww::setup {

std::shared_ptr<oww::state::State> state_;
std::unique_ptr<Adafruit_NeoPixel> led_strip_;
using namespace config::ext;

int SetLed(String command);
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

void setup(std::shared_ptr<oww::state::State> state) {
  Particle.function("led", SetLed);
  Particle.function("relais", SetRelais);
  Particle.variable("relaisState", relaisState);

  pinMode(pin_relais, INPUT);

  state_ = state;
  led_strip_ = std::make_unique<Adafruit_NeoPixel>(
      config::led::pixel_count, SPI, config::led::pixel_type);

  led_strip_->show();

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

void loop() { Display::instance().RenderLoop(); }

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

}  // namespace oww::setup
