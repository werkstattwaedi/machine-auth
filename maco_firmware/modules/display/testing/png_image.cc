// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/display/testing/png_image.h"

#include "lodepng.h"

namespace maco::display::testing {

PngImage::PngImage(uint32_t width, uint32_t height)
    : width_(width), height_(height), pixels_(width * height * 3, 0) {}

PngImage PngImage::FromRgb565(pw::span<const uint16_t> framebuffer,
                              uint32_t width,
                              uint32_t height) {
  PngImage image(width, height);

  for (size_t i = 0; i < framebuffer.size(); ++i) {
    uint8_t r, g, b;
    Rgb565ToRgb888(framebuffer[i], r, g, b);
    image.pixels_[i * 3 + 0] = r;
    image.pixels_[i * 3 + 1] = g;
    image.pixels_[i * 3 + 2] = b;
  }

  return image;
}

pw::Result<PngImage> PngImage::LoadFromFile(const std::string& path) {
  std::vector<uint8_t> png_data;
  unsigned error = lodepng::load_file(png_data, path);
  if (error) {
    return pw::Status::NotFound();
  }

  std::vector<uint8_t> rgba_pixels;
  unsigned width, height;
  error = lodepng::decode(rgba_pixels, width, height, png_data);
  if (error) {
    return pw::Status::DataLoss();
  }

  // Convert RGBA to RGB
  PngImage image(width, height);
  for (size_t i = 0; i < width * height; ++i) {
    image.pixels_[i * 3 + 0] = rgba_pixels[i * 4 + 0];
    image.pixels_[i * 3 + 1] = rgba_pixels[i * 4 + 1];
    image.pixels_[i * 3 + 2] = rgba_pixels[i * 4 + 2];
  }

  return image;
}

pw::Status PngImage::SaveToFile(const std::string& path) const {
  if (empty()) {
    return pw::Status::FailedPrecondition();
  }

  // Convert RGB to RGBA for lodepng
  std::vector<uint8_t> rgba_pixels(width_ * height_ * 4);
  for (size_t i = 0; i < width_ * height_; ++i) {
    rgba_pixels[i * 4 + 0] = pixels_[i * 3 + 0];
    rgba_pixels[i * 4 + 1] = pixels_[i * 3 + 1];
    rgba_pixels[i * 4 + 2] = pixels_[i * 3 + 2];
    rgba_pixels[i * 4 + 3] = 255;  // Fully opaque
  }

  unsigned error = lodepng::encode(path, rgba_pixels, width_, height_);
  if (error) {
    return pw::Status::Internal();
  }

  return pw::OkStatus();
}

bool PngImage::Compare(const PngImage& other, PngImage* diff_out) const {
  if (width_ != other.width_ || height_ != other.height_) {
    if (diff_out) {
      // Create solid red diff to indicate size mismatch
      *diff_out = PngImage(std::max(width_, other.width_),
                           std::max(height_, other.height_));
      std::fill(diff_out->pixels_.begin(), diff_out->pixels_.end(), 0);
      for (size_t i = 0; i < diff_out->pixels_.size(); i += 3) {
        diff_out->pixels_[i] = 255;  // Red
      }
    }
    return false;
  }

  bool identical = true;

  if (diff_out) {
    *diff_out = PngImage(width_, height_);
  }

  for (size_t i = 0; i < pixels_.size(); i += 3) {
    bool pixel_matches = (pixels_[i + 0] == other.pixels_[i + 0]) &&
                         (pixels_[i + 1] == other.pixels_[i + 1]) &&
                         (pixels_[i + 2] == other.pixels_[i + 2]);

    if (!pixel_matches) {
      identical = false;
    }

    if (diff_out) {
      if (pixel_matches) {
        // Dimmed version of original pixel
        diff_out->pixels_[i + 0] = static_cast<uint8_t>(pixels_[i + 0] / 3);
        diff_out->pixels_[i + 1] = static_cast<uint8_t>(pixels_[i + 1] / 3);
        diff_out->pixels_[i + 2] = static_cast<uint8_t>(pixels_[i + 2] / 3);
      } else {
        // Red for differences
        diff_out->pixels_[i + 0] = 255;
        diff_out->pixels_[i + 1] = 0;
        diff_out->pixels_[i + 2] = 0;
      }
    }
  }

  return identical;
}

}  // namespace maco::display::testing
