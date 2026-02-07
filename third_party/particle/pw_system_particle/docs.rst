.. _module-pw_system_particle:

==================
pw_system_particle
==================
Particle Device OS integration for :ref:`module-pw_system`.

This module provides a stub scheduler startup for ``pw_system`` on Particle
devices where the FreeRTOS scheduler is already running.

-----
Background
-----
On most embedded platforms using ``pw_system``, the application calls
``pw::system::StartSchedulerAndClobberTheStack()`` at the end of ``main()``
to start the RTOS scheduler. This function never returns - it hands control
to the scheduler.

On Particle Device OS, the FreeRTOS scheduler is **already running** when
user code starts. The Device OS manages the scheduler lifecycle, so we must
not call ``vTaskStartScheduler()``.

-----
Setup
-----
Include this target when building ``pw_system`` applications:

.. code-block:: python

   deps = [
       "@particle_bazel//pw_system_particle:threads",
   ],

This replaces the default ``pw_system/threads.cc`` with the Particle version.

-----
Behavior
-----
The Particle implementation of ``StartSchedulerAndClobberTheStack()`` simply
sleeps forever:

.. code-block:: cpp

   [[noreturn]] void StartSchedulerAndClobberTheStack() {
     while (true) {
       pw::this_thread::sleep_for(std::chrono::hours(24));
     }
   }

This keeps the calling thread (typically the Device OS application thread)
alive while ``pw_system`` worker threads run independently.

-----------------------
Implementation Details
-----------------------
- Provides ``pw::system::StartSchedulerAndClobberTheStack()``
- Does **not** call ``vTaskStartScheduler()`` (would crash)
- All ``pw_system`` threads must be created before this is called
- Uses ``pw::this_thread::sleep_for()`` to idle

----------
Bazel Targets
----------
- ``//pw_system_particle:threads`` - Scheduler startup stub
