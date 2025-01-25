#include "display.h"

#include "../config.h"
#include "drivers/display/lcd/lv_lcd_generic_mipi.h"

// clang-format off

// sitronix ST7789V LCD commands from
// https://wiki.pine64.org/images/5/54/ST7789V_v1.6.pdf

#define CMD_NOP 0x00        // NOP
#define CMD_SWRESET 0x01    // Software Reset
#define CMD_RDDID 0x04      // Read Display ID
#define CMD_RDDST 0x09      // Read Display Status
#define CMD_RDDPM 0x0A      // Read Display Power Mode
#define CMD_RDDMADCTL 0x0B  // Read Display MADCTL
#define CMD_RDDCOLMOD 0x0C  // Read Display Pixel Format
#define CMD_RDDIM 0x0D      // Read Display Image Mode
#define CMD_RDDSM 0x0E      // Read Display Signal Mode
#define CMD_RDDSDR 0x0F     // Read Display Self-Diagnostic Result
#define CMD_SLPIN 0x10      // Sleep in
#define CMD_SLPOUT 0x11     // Sleep Out
#define CMD_PTLON 0x12      // Partial Display Mode On
#define CMD_NORON 0x13      // Normal Display Mode On
#define CMD_INVOFF 0x20     // Display Inversion Off
#define CMD_INVON 0x21      // Display Inversion On
#define CMD_GAMSET 0x26     // Gamma Set
#define CMD_DISPOFF 0x28    // Display Off
#define CMD_DISPON 0x29     // Display On
#define CMD_CASET 0x2A      // Column Address Set
#define CMD_RASET 0x2B      // Row Address Set
#define CMD_RAMWR 0x2C      // Memory Write
#define CMD_RAMRD 0x2E      // Memory Read
#define CMD_PTLAR 0x30      // Partial Area
#define CMD_VSCRDEF 0x33    // Vertical Scrolling Definition
#define CMD_TEOFF 0x34      // Tearing Effect Line OFF
#define CMD_TEON 0x35       // Tearing Effect Line On
#define CMD_MADCTL 0x36     // Memory Data Access Control
#define CMD_VSCSAD 0x37     // Vertical Scroll Start Address of RAM
#define CMD_IDMOFF 0x38     // Idle Mode Off
#define CMD_IDMON 0x39      // Idle mode on
#define CMD_COLMOD 0x3A     // Interface Pixel Format
#define CMD_WRMEMC 0x3C     // Write Memory Continue
#define CMD_RDMEMC 0x3E     // Read Memory Continue
#define CMD_STE 0x44        // Set Tear Scanline
#define CMD_GSCAN 0x45      // Get Scanline
#define CMD_WRDISBV 0x51    // Write Display Brightness
#define CMD_RDDISBV 0x52    // Read Display Brightness Value
#define CMD_WRCTRLD 0x53    // Write CTRL Display
#define CMD_RDCTRLD 0x54    // Read CTRL Value Display
#define CMD_WRCACE  0x55    // Write Content Adaptive Brightness Control and Color Enhancement
#define CMD_RDCABC 0x56     // Read Content Adaptive Brightness Control
#define CMD_WRCABCMB 0x5E   // Write CABC Minimum Brightness
#define CMD_RDCABCMB 0x5F   // Read CABC Minimum Brightness
#define CMD_RDABCSDR 0x68   // Read Automatic Brightness Control Self-Diagnostic Result
#define CMD_RDID1 0xDA      // Read ID1
#define CMD_RDID2 0xDB      // Read ID2
#define CMD_RDID3 0xDC      // Read ID3
#define CMD_RAMCTRL 0xB0    // RAM Control
#define CMD_RGBCTRL 0xB1    // RGB Interface Control
#define CMD_PORCTRL 0xB2    // Porch Setting
#define CMD_FRCTRL1 0xB3    // Frame Rate Control 1 0xIn partial mode/ idle colors)
#define CMD_PARCTRL 0xB5    // Partial Control
#define CMD_GCTRL 0xB7      // Gate Control
#define CMD_GTADJ 0xB8      // Gate On Timing Adjustment
#define CMD_DGMEN 0xBA      // Digital Gamma Enable
#define CMD_VCOMS 0xBB      // VCOM Setting
#define CMD_LCMCTRL 0xC0    // LCM Control
#define CMD_IDSET 0xC1      // ID Code Setting
#define CMD_VDVVRHEN 0xC2   // VDV and VRH Command Enable
#define CMD_VRHS 0xC3       // VRH Set
#define CMD_VDVS 0xC4       // VDV Set
#define CMD_VCMOFSET 0xC5   // VCOM Offset Set
#define CMD_FRCTRL2 0xC6    // Frame Rate Control in Normal Mode
#define CMD_CABCCTRL 0xC7   // CABC Control
#define CMD_REGSEL1 0xC8    // Register Value Selection 1
#define CMD_REGSEL2 0xCA    // Register Value Selection 2
#define CMD_PWMFRSEL 0xCC   // PWM Frequency Selection
#define CMD_PWCTRL1 0xD0    // Power Control 1
#define CMD_VAPVANEN 0xD2   // Enable VAP/VAN signal output
#define CMD_CMD2EN 0xDF     // Command 2 Enable
#define CMD_PVGAMCTRL 0xE0  // Positive Voltage Gamma Control
#define CMD_NVGAMCTRL 0xE1  // Negative Voltage Gamma Control
#define CMD_DGMLUTR 0xE2    // Digital Gamma Look-up Table for Red
#define CMD_DGMLUTB 0xE3    // Digital Gamma Look-up Table for Blue
#define CMD_GATECTRL 0xE4   // Gate Control
#define CMD_SPI2EN 0xE7     // SPI2 Enable
#define CMD_PWCTRL2 0xE8    // Power Control 2
#define CMD_EQCTRL 0xE9     // Equalize time control
#define CMD_PROMCTRL 0xEC   // Program Mode Control
#define CMD_PROMEN 0xFA     // Program Mode Enable
#define CMD_NVMSET 0xFC     // NVM Setting
#define CMD_PROMACT 0xFE    // Program action

// init commands based on Waveshare ST7789 driver.
static const uint8_t init_cmd_list[] = { 
    CMD_GCTRL, 1, 0x35, 
    CMD_VCOMS, 1, 0x28, 
    CMD_VRHS, 1, 0x0b,  
    CMD_GCTRL, 1, 0x44,  
    CMD_VCOMS, 1, 0x24,  
    CMD_VRHS, 1, 0x13,   
    CMD_PWCTRL1, 2, 0xa4, 0xa1,
    CMD_RAMCTRL, 2, 0x00, 0xC0,
    CMD_PVGAMCTRL, 14, 0xd0, 0x01, 0x08, 0x0f, 0x11, 0x2a, 0x36, 0x55, 0x44, 0x3a, 0x0b, 0x06, 0x11, 0x20,  // Positive Voltage Gamma Control
    CMD_NVGAMCTRL, 14, 0xd0, 0x02, 0x07, 0x0a, 0x0b, 0x18, 0x34, 0x43, 0x4a, 0x2b, 0x1b, 0x1c, 0x22, 0x1f,  // Negative Voltage Gamma Control
    CMD_GAMSET, 1, 0x01,
    LV_LCD_CMD_DELAY_MS, LV_LCD_CMD_EOF 
};

// clang-format on

using namespace config::display;

Logger display_log(logtag);

Display *Display::instance_;

Display &Display::instance() {
  if (!instance_) {
    instance_ = new Display();
  }
  return *instance_;
}

Display::Display()
    : spi_interface_(SPI1),
      spi_settings_(50 * MHZ, MSBFIRST, SPI_MODE0),
      touchscreen_interface_(SPI1, resolution_horizontal, resolution_vertical,
                             pin_touch_chipselect, pin_touch_irq) {}

Display::~Display() {}

Status Display::Begin() {
  if (thread_ != nullptr) {
    display_log.error("Display::Begin() Already initialized");
    return Status::kError;
  }

  pinMode(pin_reset, OUTPUT);
  pinMode(pin_chipselect, OUTPUT);
  pinMode(pin_datacommand, OUTPUT);
  pinMode(pin_backlight, OUTPUT);

  spi_interface_.begin();

  digitalWrite(pin_backlight, HIGH);
  digitalWrite(pin_reset, HIGH);

  delay(200);
  digitalWrite(pin_reset, LOW);
  delay(200);
  digitalWrite(pin_reset, HIGH);
  delay(200);

  lv_init();
  lv_log_register_print_cb(
      [](lv_log_level_t level, const char *buf) { display_log.print(buf); });

  lv_tick_set_cb([]() { return millis(); });

  display_ = lv_lcd_generic_mipi_create(
      resolution_horizontal, resolution_vertical,
      LV_LCD_PIXEL_FORMAT_RGB666 | LV_LCD_FLAG_MIRROR_X,
      [](auto *disp, auto *cmd, auto cmd_size, auto *param, auto param_size) {
        Display::instance().SendCommandDirect(cmd, cmd_size, param, param_size);
      },
      [](auto *disp, auto *cmd, auto cmd_size, auto *param, auto param_size) {
        Display::instance().SendCommandDma(cmd, cmd_size, param, param_size);
      });

  lv_lcd_generic_mipi_send_cmd_list(display_, init_cmd_list);
  lv_lcd_generic_mipi_set_invert(display_, true);

  // Photon2 has 3MB of RAM, so easily use 2 full size buffers (~160k each)
  uint32_t buf_size =
      resolution_horizontal * resolution_vertical *
      lv_color_format_get_size(lv_display_get_color_format(display_));

  lv_color_t *buffer_1 = (lv_color_t *)malloc(buf_size);
  if (buffer_1 == NULL) {
    Log.error("display draw buffer malloc failed");
    return Status::kError;
  }

  lv_color_t *buffer_2 = (lv_color_t *)malloc(buf_size);
  if (buffer_2 == NULL) {
    Log.error("display buffer malloc failed");
    lv_free(buffer_1);
    return Status::kError;
  }

  lv_display_set_buffers(display_, buffer_1, buffer_2, buf_size,
                         LV_DISPLAY_RENDER_MODE_PARTIAL);

  os_mutex_create(&mutex_);

  touchscreen_interface_.begin();

  lv_indev_t *indev = lv_indev_create();
  lv_indev_set_type(
      indev, LV_INDEV_TYPE_POINTER); /* Touch pad is a pointer-like device. */
  lv_indev_set_read_cb(indev, [](auto indev, auto data) {
    Display::instance().ReadTouchInput(indev, data);
  });

  thread_ = new Thread(
      "Display", [this]() { DisplayThreadFunction(); }, thread_priority,
      thread_stack_size);

  return Status::kOk;
}

void Display::DisplayThreadFunction() {
  lv_obj_set_style_bg_color(lv_screen_active(), lv_color_white(), LV_PART_MAIN);

  /*Create a white label, set its text and align it to the center*/
  lv_obj_t *label = lv_label_create(lv_screen_active());
  lv_label_set_text(label, "Hello Waedi!");
  lv_obj_set_style_text_color(lv_screen_active(), lv_color_hex(0x0000ff),
                              LV_PART_MAIN);

  lv_anim_t a;
  lv_anim_init(&a);
  lv_anim_set_var(&a, label);
  lv_anim_set_values(&a, 0, 50);
  lv_anim_set_duration(&a, 1000);
  lv_anim_set_repeat_delay(&a, 500);
  lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
  lv_anim_set_path_cb(&a, lv_anim_path_ease_in_out);

  lv_anim_set_exec_cb(&a, [](void *var, int32_t v) {
    lv_obj_align((lv_obj_t *)var, LV_ALIGN_CENTER, 0, v);
  });
  lv_anim_start(&a);

  while (true) {
    RenderFrame();

    uint32_t time_till_next = lv_timer_handler();
    delay(time_till_next);
    display_log.info("Frame complete");
  }
}

void Display::RenderFrame() {}

void Display::SendCommandDirect(const uint8_t *cmd, size_t cmd_size,
                                const uint8_t *param, size_t param_size) {
  spi_interface_.beginTransaction(spi_settings_);

  pinResetFast(pin_chipselect);
  pinResetFast(pin_datacommand);

  for (size_t i = 0; i < cmd_size; i++) {
    spi_interface_.transfer(cmd[i]);
  }
  pinSetFast(pin_datacommand);

  for (size_t i = 0; i < param_size; i++) {
    spi_interface_.transfer(param[i]);
  }
  pinSetFast(pin_chipselect);

  spi_interface_.endTransaction();
}

void Display::SendCommandDma(const uint8_t *cmd, size_t cmd_size,
                             const uint8_t *param, size_t param_size) {
  spi_interface_.beginTransaction(spi_settings_);
  pinResetFast(pin_chipselect);
  pinResetFast(pin_datacommand);

  for (size_t i = 0; i < cmd_size; i++) {
    spi_interface_.transfer(cmd[i]);
  }

  pinSetFast(pin_datacommand);
  spi_interface_.transfer(param, nullptr, param_size, nullptr);

  pinSetFast(pin_chipselect);

  Display::instance_->spi_interface_.endTransaction();
  lv_display_flush_ready(Display::instance_->display_);
}

void Display::ReadTouchInput(lv_indev_t *indev, lv_indev_data_t *data) {
  // if (touchscreen_interface_.touched()) {
  //   TS_Point p = touchscreen_interface_.getPoint();
  //   auto x = map(p.x, 220, 3850, 1, 480);  //
  //   auto y = map(p.y, 310, 3773, 1, 320);  // Feel pretty good about this
  //   data->point.x = x;
  //   data->point.y = y;
  //   data->state = LV_INDEV_STATE_PR;

  // } else {
    data->state = LV_INDEV_STATE_REL;
  // }
}
