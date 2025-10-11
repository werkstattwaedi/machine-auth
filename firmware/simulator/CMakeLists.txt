cmake_minimum_required(VERSION 3.16)
project(machine_auth_simulator)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find SDL2
find_package(SDL2 REQUIRED)

# Find SDL2_ttf using pkg-config
find_package(PkgConfig REQUIRED)
pkg_check_modules(SDL2_TTF REQUIRED SDL2_ttf)

# LVGL library path
set(LVGL_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../lib/lvgl)

# LVGL sources
file(GLOB_RECURSE LVGL_SOURCES
  ${LVGL_DIR}/src/*.c
)

# Filter out Particle-specific drivers
list(FILTER LVGL_SOURCES EXCLUDE REGEX ".*src/drivers/.*")

# Add back SDL driver
file(GLOB LVGL_SDL_SOURCES
  ${LVGL_DIR}/src/drivers/sdl/*.c
)

# Custom fonts and images from firmware
set(CUSTOM_ASSETS
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/ui/fonts/roboto_24.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/ui/fonts/roboto_12.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/ui/image/oww_logo.c
)

# Shared UI sources from firmware
set(SHARED_UI_SOURCES
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/ui/core/ui_manager.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/ui/components/component.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/ui/components/buttonbar.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/ui/components/maincontent.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/ui/components/sessionstatus.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/ui/components/splashscreen.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/../src/ui/components/statusbar.cpp
)

# Simulator sources
set(SIMULATOR_SOURCES
  main.cpp
  hal/simulator_hardware.cpp
  mock/mock_application.cpp
)

# Create executable
add_executable(simulator
  ${SIMULATOR_SOURCES}
  ${SHARED_UI_SOURCES}
  ${LVGL_SOURCES}
  ${LVGL_SDL_SOURCES}
  ${CUSTOM_ASSETS}
)

# Include directories
target_include_directories(simulator PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../src
  ${LVGL_DIR}
  ${SDL2_INCLUDE_DIRS}
  ${SDL2_TTF_INCLUDE_DIRS}
)

# Compile definitions
target_compile_definitions(simulator PRIVATE
  LV_CONF_INCLUDE_SIMPLE=1
  LV_USE_SDL=1
  SIMULATOR_BUILD=1
)

# Link libraries
target_link_libraries(simulator
  ${SDL2_LIBRARIES}
  ${SDL2_TTF_LIBRARIES}
  m  # Math library for sin/cos
)

# Compiler warnings
target_compile_options(simulator PRIVATE
  -Wall
  -Wextra
  -Wno-unused-parameter
)

# Copy lv_conf.h to build directory if needed
configure_file(
  ${LVGL_DIR}/lv_conf.h
  ${CMAKE_CURRENT_BINARY_DIR}/lv_conf.h
  COPYONLY
)
