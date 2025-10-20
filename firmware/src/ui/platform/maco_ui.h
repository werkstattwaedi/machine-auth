#pragma once

#include <lvgl.h>

#include "common.h"
#include "hal/hardware_interface.h"
#include "logic/application.h"
#include "neopixel.h"
#include "ui/core/ui_manager.h"

namespace oww::ui {

class MacoUI : public hal::IHardware {
 public:
  static MacoUI& instance();

  tl::expected<void, ErrorType> Begin(
      std::shared_ptr<oww::logic::Application> app);

 public:
  // IHardware interface implementation
  void SetLedEffect(std::shared_ptr<hal::ILedEffect> effect) override;
  void Beep(uint16_t frequency_hz, uint16_t duration_ms) override;

 private:
  // MacoUI is a singleton - use MacoUI.instance()
  static MacoUI* instance_;
  MacoUI();

  virtual ~MacoUI();
  MacoUI(const MacoUI&) = delete;
  MacoUI& operator=(const MacoUI&) = delete;

  static Logger logger;

  std::shared_ptr<oww::logic::Application> app_ = nullptr;
  std::shared_ptr<hal::ILedEffect> led_effect_;
  std::unique_ptr<UiManager> ui_manager_;

  Thread* ui_thread_ = nullptr;
  Thread* led_thread_ = nullptr;

  os_thread_return_t UserInterfaceThread();
  os_thread_return_t LedThread();

  // Set up button position mappings for touch input
  Adafruit_NeoPixel led_strip_;
};

}  // namespace oww::ui
