.. _module-pw_thread_particle:

==================
pw_thread_particle
==================
Particle Device OS backend for :ref:`module-pw_thread`.

This module provides thread creation, identification, yielding, and sleeping
using the FreeRTOS scheduler that runs within Particle Device OS.

.. note::

   The FreeRTOS scheduler is already running when user code starts on Particle
   devices. Do not call ``vTaskStartScheduler()`` - threads can be created
   immediately.

-----
Setup
-----
Configure the backend in your project's label flags:

.. code-block:: python

   # In .bazelrc or BUILD
   "--@pigweed//pw_thread:id_backend=@particle_bazel//pw_thread_particle:id",
   "--@pigweed//pw_thread:sleep_backend=@particle_bazel//pw_thread_particle:sleep",
   "--@pigweed//pw_thread:thread_backend=@particle_bazel//pw_thread_particle:thread",
   "--@pigweed//pw_thread:yield_backend=@particle_bazel//pw_thread_particle:yield",

---------------
Thread Creation
---------------
Threads are created using ``pw::Thread`` with Particle-specific options.

Options
=======
The ``pw::thread::particle::Options`` class configures thread creation:

.. cpp:class:: pw::thread::particle::Options

   .. cpp:function:: constexpr Options& set_name(const char* name)

      Sets the thread name (default: ``"pw::Thread"``).

   .. cpp:function:: constexpr Options& set_priority(int priority)

      Sets the thread priority. Device OS priorities range from 0-9, with
      higher numbers being higher priority. Default is 5.

   .. cpp:function:: constexpr Options& set_stack_size(size_t size_bytes)

      Sets the stack size for dynamic allocation. Minimum is 512 bytes.
      Default is 4096 bytes.

   .. cpp:function:: constexpr Options& set_static_context(StaticContext& context)

      Uses pre-allocated memory for the thread instead of dynamic allocation.

Example
=======
.. code-block:: cpp

   #include "pw_thread/thread.h"
   #include "pw_thread_particle/options.h"

   void WorkerFunction() {
     while (true) {
       // Do work...
       pw::this_thread::sleep_for(100ms);
     }
   }

   // Dynamic allocation
   pw::Thread worker_thread(
       pw::thread::particle::Options()
           .set_name("worker")
           .set_priority(6)
           .set_stack_size(2048),
       WorkerFunction);

   // Static allocation (no heap usage)
   pw::thread::particle::StaticContext<2048> static_context;
   pw::Thread static_thread(
       pw::thread::particle::Options()
           .set_name("static_worker")
           .set_static_context(static_context),
       WorkerFunction);

---------------------
Thread Identification
---------------------
Get the current thread's ID:

.. code-block:: cpp

   #include "pw_thread/id.h"

   void SomeFunction() {
     pw::Thread::id my_id = pw::this_thread::get_id();
   }

--------------
Thread Helpers
--------------

Yield
=====
Yield execution to other ready threads:

.. code-block:: cpp

   #include "pw_thread/yield.h"

   pw::this_thread::yield();

Sleep
=====
Sleep for a duration or until a time point:

.. code-block:: cpp

   #include "pw_thread/sleep.h"
   #include "pw_chrono/system_clock.h"

   using namespace std::chrono_literals;

   // Sleep for duration
   pw::this_thread::sleep_for(100ms);

   // Sleep until time point
   auto wake_time = pw::chrono::SystemClock::now() + 1s;
   pw::this_thread::sleep_until(wake_time);

----------------
Thread Iteration
----------------
Iterate over all threads (useful for debugging):

.. code-block:: cpp

   #include "pw_thread/thread_iteration.h"

   pw::thread::ForEachThread([](const pw::thread::ThreadInfo& info) {
     PW_LOG_INFO("Thread: %s", info.name().data());
     return true;  // Continue iteration
   });

-----------------------
Implementation Details
-----------------------
- Uses Device OS HAL functions: ``os_thread_create()``, ``os_thread_yield()``,
  ``os_thread_delay()``
- Thread IDs are FreeRTOS ``TaskHandle_t`` values
- Sleep uses ``os_thread_delay_until()`` for accurate timing
- Minimum stack size enforced at 512 bytes
- Thread names are passed to FreeRTOS for debugger visibility

----------
Bazel Targets
----------
- ``//pw_thread_particle:thread`` - Thread creation
- ``//pw_thread_particle:id`` - Thread identification
- ``//pw_thread_particle:yield`` - Thread yielding
- ``//pw_thread_particle:sleep`` - Thread sleeping
- ``//pw_thread_particle:thread_iteration`` - Thread enumeration
- ``//pw_thread_particle:thread_context`` - Generic thread creation support
