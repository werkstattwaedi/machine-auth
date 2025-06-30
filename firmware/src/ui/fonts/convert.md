# Create fonts

This project uses Google's [Roboto](https://fonts.google.com/specimen/Roboto) font, and supports rendering latin-1 characters.


## Install

Install lvgl's font converter

```
npm i lv_font_conv -g
```


## Convert

Run the following commands in the `firmware/src/ui/fonts` directory

```
lv_font_conv --bpp 4 --size 12 --no-compress --font Roboto-Regular.ttf --range 32-255 --format lvgl --lv-include lvgl.h -o roboto_12.c
lv_font_conv --bpp 4 --size 24 --no-compress --font Roboto-Regular.ttf --range 32-255 --format lvgl --lv-include lvgl.h -o roboto_24.c
```