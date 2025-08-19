#include "stresstest.h"
#include "common.h"
#include <math.h>

Logger stress_log("stress");

// Static member definitions
lv_obj_t* StressTest::container_ = nullptr;
lv_obj_t* StressTest::moving_rect_ = nullptr;
lv_obj_t* StressTest::color_bars_[8] = {nullptr};
lv_obj_t* StressTest::gradient_rect_ = nullptr;
lv_timer_t* StressTest::animation_timer_ = nullptr;
uint32_t StressTest::frame_counter_ = 0;
uint32_t StressTest::start_time_ = 0;

void StressTest::CreateWidget(lv_obj_t* parent) {
    if (container_) {
        // Already created
        return;
    }
    
    lv_obj_t* screen = parent ? parent : lv_scr_act();
    
    // Create main container
    container_ = lv_obj_create(screen);
    lv_obj_set_size(container_, 240, 320);
    lv_obj_set_pos(container_, 0, 0);
    lv_obj_clear_flag(container_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(container_, lv_color_hex(0x000000), 0);
    lv_obj_set_style_border_width(container_, 0, 0);
    lv_obj_set_style_pad_all(container_, 0, 0);
    
    // Create animated color bars - these will change colors rapidly
    for (int i = 0; i < 8; i++) {
        color_bars_[i] = lv_obj_create(container_);
        lv_obj_set_size(color_bars_[i], 30, 240);
        lv_obj_set_pos(color_bars_[i], i * 30, 40);
        lv_obj_clear_flag(color_bars_[i], LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_style_border_width(color_bars_[i], 0, 0);
        lv_obj_set_style_bg_color(color_bars_[i], lv_color_hex(0xFF0000), 0);
    }
    
    // Create moving rectangle
    moving_rect_ = lv_obj_create(container_);
    lv_obj_set_size(moving_rect_, 40, 40);
    lv_obj_set_pos(moving_rect_, 0, 0);
    lv_obj_clear_flag(moving_rect_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_border_width(moving_rect_, 2, 0);
    lv_obj_set_style_border_color(moving_rect_, lv_color_hex(0xFFFFFF), 0);
    lv_obj_set_style_bg_color(moving_rect_, lv_color_hex(0x00FF00), 0);
    
    // Create gradient rectangle that changes colors
    gradient_rect_ = lv_obj_create(container_);
    lv_obj_set_size(gradient_rect_, 240, 40);
    lv_obj_set_pos(gradient_rect_, 0, 280);
    lv_obj_clear_flag(gradient_rect_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_border_width(gradient_rect_, 0, 0);
    
    // Create gradient style
    static lv_style_t gradient_style;
    lv_style_init(&gradient_style);
    lv_style_set_bg_grad_color(&gradient_style, lv_color_hex(0xFF0000));
    lv_style_set_bg_grad_dir(&gradient_style, LV_GRAD_DIR_HOR);
    lv_obj_add_style(gradient_rect_, &gradient_style, 0);
    
    stress_log.info("Stress test widget created");
}

void StressTest::Start() {
    if (!container_) {
        CreateWidget();
    }
    
    if (animation_timer_) {
        // Already running
        return;
    }
    
    frame_counter_ = 0;
    start_time_ = millis();
    
    // Create high-frequency timer for animations (30ms = ~33 FPS)
    animation_timer_ = lv_timer_create(AnimationCallback, 30, nullptr);
    
    stress_log.info("Stress test started");
}

void StressTest::Stop() {
    if (animation_timer_) {
        lv_timer_del(animation_timer_);
        animation_timer_ = nullptr;
    }
    
    if (container_) {
        lv_obj_del(container_);
        container_ = nullptr;
        moving_rect_ = nullptr;
        gradient_rect_ = nullptr;
        for (int i = 0; i < 8; i++) {
            color_bars_[i] = nullptr;
        }
    }
    
    stress_log.info("Stress test stopped");
}

void StressTest::AnimationCallback(lv_timer_t* timer) {
    if (!container_) return;
    
    frame_counter_++;
    uint32_t elapsed = millis() - start_time_;
    
    // Log frame rate every 5 seconds
    if (elapsed > 0 && frame_counter_ % 150 == 0) {
        float fps = (float)frame_counter_ * 1000.0f / elapsed;
        stress_log.info("Stress test FPS: %.1f, Frame: %lu", fps, frame_counter_);
    }
    
    // Animate moving rectangle in a circular pattern
    if (moving_rect_) {
        float angle = (frame_counter_ * 0.1f);
        int center_x = 120;
        int center_y = 160;
        int radius = 80;
        
        int x = center_x + (int)(cos(angle) * radius) - 20;
        int y = center_y + (int)(sin(angle) * radius) - 20;
        
        // Clamp to screen bounds
        x = x < 0 ? 0 : (x > 200 ? 200 : x);
        y = y < 0 ? 0 : (y > 280 ? 280 : y);
        
        lv_obj_set_pos(moving_rect_, x, y);
        
        // Change color every 30 frames
        if (frame_counter_ % 30 == 0) {
            uint32_t colors[] = {0x00FF00, 0x0000FF, 0xFF00FF, 0x00FFFF, 0xFFFF00, 0xFF0000};
            int color_idx = (frame_counter_ / 30) % 6;
            lv_obj_set_style_bg_color(moving_rect_, lv_color_hex(colors[color_idx]), 0);
        }
    }
    
    // Animate color bars with different colors
    for (int i = 0; i < 8; i++) {
        if (color_bars_[i]) {
            // Each bar cycles through different hues with different phases
            float hue_offset = (frame_counter_ * 2 + i * 45) % 360;
            lv_color_t color = lv_color_hsv_to_rgb(hue_offset, 100, 100);
            lv_obj_set_style_bg_color(color_bars_[i], color, 0);
        }
    }
    
    // Animate gradient rectangle
    if (gradient_rect_) {
        float hue1 = (frame_counter_ * 3) % 360;
        float hue2 = (frame_counter_ * 3 + 180) % 360;
        
        lv_obj_set_style_bg_color(gradient_rect_, lv_color_hsv_to_rgb(hue1, 100, 100), 0);
        lv_obj_set_style_bg_grad_color(gradient_rect_, lv_color_hsv_to_rgb(hue2, 100, 100), 0);
    }
    
    // Force immediate redraw to stress the SPI interface
    lv_obj_invalidate(container_);
}
