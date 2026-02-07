.. _module-pw_assert_particle:

==================
pw_assert_particle
==================
Particle Device OS handler for :ref:`module-pw_assert`.

This module provides an assertion failure handler that logs the failure
details and resets the device into safe mode.

-----
Setup
-----
Configure the backend in your project's label flags:

.. code-block:: python

   # In .bazelrc or BUILD
   "--@pigweed//pw_assert:backend=@pigweed//pw_assert_basic",
   "--@pigweed//pw_assert_basic:handler_backend=@particle_bazel//pw_assert_particle:handler",

-----
Behavior
-----
When an assertion fails (``PW_ASSERT``, ``PW_CHECK``, ``PW_DASSERT``, etc.):

1. Logs the failure location (file, line, function) 5 times at CRITICAL level
2. Logs the assertion message (if provided)
3. Waits 1 second between each log (to ensure output is visible)
4. Enters Device OS safe mode via ``HAL_Core_Enter_Safe_Mode()``

This gives developers time to see the assertion output on serial monitor
before the device resets.

-----
Usage
-----
Assertions are typically used via Pigweed macros:

.. code-block:: cpp

   #include "pw_assert/check.h"

   void ProcessBuffer(const uint8_t* buffer, size_t size) {
     PW_CHECK_NOTNULL(buffer);
     PW_CHECK(size > 0, "Buffer size must be positive, got %zu", size);

     // Process buffer...
   }

Example Output
==============
When an assertion fails, you'll see output like:

.. code-block:: text

   CRT ASSERT FAILED: main.cc:42 in ProcessBuffer()
   CRT   Buffer size must be positive, got 0
   CRT ASSERT FAILED: main.cc:42 in ProcessBuffer()
   CRT   Buffer size must be positive, got 0
   ...

The device then enters safe mode (breathing magenta LED on Particle devices).

-----------------------
Implementation Details
-----------------------
- Implements ``pw_assert_basic_HandleFailure()`` from ``pw_assert_basic``
- Uses ``PW_LOG_CRITICAL`` for output (via ``pw_sys_io`` USB serial)
- Uses ``HAL_Delay_Milliseconds()`` for timing
- Enters safe mode via ``HAL_Core_Enter_Safe_Mode()`` (not a hard reset)

.. note::

   Safe mode allows the device to be reflashed via USB or OTA without
   bricking, even if the firmware crashes immediately on boot.

----------
Bazel Targets
----------
- ``//pw_assert_particle:handler`` - Assert failure handler
