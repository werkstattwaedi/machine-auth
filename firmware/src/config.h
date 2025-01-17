#pragma once

// Adds extra logging during development
#if !defined(DEVELOPMENT_BUILD)
#define DEVELOPMENT_BUILD 1
#endif

#define HW_NFC_RESET D15
#define HW_NFC_IRQ D17
#define HW_NFC_SERIAL Serial1

#define PIN_LCD_DC D10  // Data/Command -> low command, high data
#define PIN_LCD_BACKLIGHT D7
#define PIN_LCD_RESET D6
#define PIN_LCD_CS D5