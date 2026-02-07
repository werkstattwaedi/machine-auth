.. _module-pb_watchdog:

===========
pb_watchdog
===========
Hardware watchdog wrapper for Particle Device OS.

This module provides a Pigweed-style interface to the hardware watchdog timer,
which resets the device if the application becomes unresponsive.

-----
Setup
-----
Add the dependency to your BUILD.bazel:

.. code-block:: python

   deps = [
       "@particle_bazel//pb_watchdog:watchdog",
       "@pigweed//pw_status",
   ],

-----
Usage
-----
Basic Usage
===========
.. code-block:: cpp

   #include "pb_watchdog/watchdog.h"

   pb::watchdog::Watchdog wdt;

   void setup() {
     // Enable watchdog with 10 second timeout
     wdt.Enable(std::chrono::seconds(10));
   }

   void loop() {
     DoWork();

     // Feed watchdog to prevent reset
     wdt.Feed();
   }

.. warning::

   If ``Feed()`` is not called within the timeout period, the device resets.
   Ensure all code paths eventually call ``Feed()``.

With Milliseconds
=================
.. code-block:: cpp

   // Alternative: specify timeout in milliseconds
   wdt.Enable(10000);  // 10 seconds

Expired Callback
================
Get notified just before the watchdog resets (useful for last-chance logging):

.. code-block:: cpp

   void OnWatchdogExpiring(void* context) {
     // WARNING: This runs in ISR context - keep it short!
     // Log or save diagnostic info
   }

   void setup() {
     wdt.SetExpiredCallback(OnWatchdogExpiring, nullptr);
     wdt.Enable(std::chrono::seconds(10));
   }

.. warning::

   The expired callback runs in interrupt context. Keep it very short
   and don't call blocking functions.

Query State
===========
.. code-block:: cpp

   if (wdt.IsEnabled()) {
     uint32_t timeout = wdt.GetTimeoutMs();
     PW_LOG_INFO("Watchdog enabled, timeout: %lu ms", timeout);
   }

Disabling
=========
.. code-block:: cpp

   // Disable watchdog (may not be supported on all hardware)
   wdt.Disable();

.. note::

   Some hardware does not allow disabling the watchdog once enabled.
   Check the return status.

-----
API Reference
-----
.. cpp:class:: pb::watchdog::Watchdog

   .. cpp:function:: pw::Status Enable(pw::chrono::SystemClock::duration timeout)

      Enable the watchdog with the specified timeout duration.

   .. cpp:function:: pw::Status Enable(uint32_t timeout_ms)

      Enable the watchdog with timeout in milliseconds.

   .. cpp:function:: pw::Status Disable()

      Disable the watchdog (may not be supported).

   .. cpp:function:: pw::Status Feed()

      Reset the watchdog timer. Must be called periodically.

   .. cpp:function:: pw::Status SetExpiredCallback(ExpiredCallback callback, void* context)

      Set callback invoked just before watchdog reset (ISR context).

   .. cpp:function:: bool IsEnabled() const

      Returns true if watchdog is currently enabled.

   .. cpp:function:: uint32_t GetTimeoutMs() const

      Returns the configured timeout in milliseconds.

-----------------------
Implementation Details
-----------------------
- Uses Device OS HAL: ``hal_watchdog_init()``, ``hal_watchdog_refresh()``,
  ``hal_watchdog_stop()``
- Hardware watchdog is independent of software - survives crashes
- Minimum timeout depends on hardware (typically 1-10ms minimum)
- Maximum timeout depends on hardware (typically 30+ seconds)

----------
Bazel Targets
----------
- ``//pb_watchdog:watchdog`` - Watchdog wrapper
