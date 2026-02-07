// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Particle Device OS entry point glue for Pigweed applications.
//
// This file provides the entry points that the Particle Device OS expects
// (setup, loop, module_user_init_hook, _post_loop) and bridges to the
// standard C++ main() function that Pigweed applications use.
//
// For Pigweed apps using pw_system, loop() calls main() which initializes
// the Pigweed system and never returns.
//
// IMPORTANT: We call main() from loop() instead of setup() so that Device OS
// marks APPLICATION_SETUP_DONE=true after setup() returns. This enables:
// - Cloud subscriptions to be sent when spark_subscribe() is called
// - Proper handling of cloud reconnection (subscriptions resent automatically)
// Without this, Pigweed apps in AUTOMATIC mode would never send subscriptions
// to the cloud because the APPLICATION_SETUP_DONE check would fail.

extern "C" {

// Forward declaration of main() - provided by the Pigweed application.
int main();

// Called once during user module initialization.
void module_user_init_hook() {
    // No-op - Pigweed handles its own initialization in main().
}

// Called once after device initialization.
// Returns immediately so Device OS can mark APPLICATION_SETUP_DONE=true.
void setup() {
    // No-op - actual initialization happens in loop() -> main()
}

// Called repeatedly after setup().
// We call main() here which never returns for pw_system based apps.
void loop() {
    main();
    // main() should never return for pw_system based apps.
}

// Called after each loop() iteration.
// For Pigweed apps, this is never reached since loop() never returns.
void _post_loop() {
    // No-op
}

}  // extern "C"
