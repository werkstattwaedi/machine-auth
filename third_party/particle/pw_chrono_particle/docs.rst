.. _module-pw_chrono_particle:

==================
pw_chrono_particle
==================
Particle Device OS backend for :ref:`module-pw_chrono`.

This module provides system clock and timer functionality using the Device OS
hardware timer HAL.

-----
Setup
-----
Configure the backends in your project's label flags:

.. code-block:: python

   # In .bazelrc or BUILD
   "--@pigweed//pw_chrono:system_clock_backend=@particle_bazel//pw_chrono_particle:system_clock",
   "--@pigweed//pw_chrono:system_timer_backend=@particle_bazel//pw_chrono_particle:system_timer",

------------
System Clock
------------
Provides a monotonic clock with 1ms tick resolution.

Configuration
=============
- **Tick period**: 1 millisecond (1/1000 second)
- **Epoch**: Time since boot (``Epoch::kUnknown``)
- **Free-running**: Yes (hardware timer continues in critical sections)
- **NMI-safe**: No

Usage
=====
.. code-block:: cpp

   #include "pw_chrono/system_clock.h"

   using namespace std::chrono_literals;

   void MeasureTime() {
     auto start = pw::chrono::SystemClock::now();

     // Do work...

     auto elapsed = pw::chrono::SystemClock::now() - start;
     auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(elapsed);
     PW_LOG_INFO("Elapsed: %lld ms", elapsed_ms.count());
   }

   void WaitUntilDeadline() {
     auto deadline = pw::chrono::SystemClock::now() + 5s;
     while (pw::chrono::SystemClock::now() < deadline) {
       // Poll or do work...
     }
   }

------------
System Timer
------------
Software timer for scheduling callbacks at future time points.

Usage
=====
.. code-block:: cpp

   #include "pw_chrono/system_timer.h"

   void OnTimerExpired(pw::chrono::SystemClock::time_point expired_at) {
     PW_LOG_INFO("Timer fired!");
   }

   void ScheduleTimer() {
     pw::chrono::SystemTimer timer(OnTimerExpired);

     // Fire in 500ms
     timer.InvokeAfter(500ms);

     // Or fire at a specific time
     timer.InvokeAt(pw::chrono::SystemClock::now() + 1s);

     // Cancel if no longer needed
     timer.Cancel();
   }

.. note::

   The callback runs in the Device OS timer task context, not an ISR.
   Keep callbacks reasonably short and don't block.

-----------------------
Implementation Details
-----------------------
System Clock
============
- Uses ``hal_timer_millis()`` which returns a 64-bit millisecond count
- Hardware-based, continues running during interrupt disable
- Does not wrap (64-bit counter lasts ~292 million years)

System Timer
============
- Uses Device OS software timers (``os_timer_*`` functions)
- One-shot timers with automatic rescheduling for long delays
- Maximum single timer period is ``CONCURRENT_WAIT_FOREVER - 1`` ms
- For longer delays, the timer automatically reschedules itself
- Callback receives the scheduled expiry time (not actual fire time)

----------
Bazel Targets
----------
- ``//pw_chrono_particle:system_clock`` - System clock backend
- ``//pw_chrono_particle:system_timer`` - System timer backend
