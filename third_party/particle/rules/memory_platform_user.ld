/*
 * Default memory values for first-pass linking.
 * These are generous defaults that match Particle's Make build PREBUILD phase.
 * The actual sizes will be calculated after the first link and used for the final link.
 *
 * See: device-os/modules/shared/rtl872x/build_linker_script.mk (PREBUILD branch)
 */

/* Conservative defaults - large enough to fit any reasonable user module.
 * 256K accommodates Pigweed firmware (~138KB: 64KB LVGL + 30KB display + 20KB pw_system). */
platform_user_part_flash_size = 1536K;
platform_user_part_static_ram_size = 256K;
platform_user_part_secure_ram_size = 4K;
platform_user_part_psram_size = 1536K;
