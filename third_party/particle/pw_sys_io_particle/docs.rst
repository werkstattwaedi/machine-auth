.. _module-pw_sys_io_particle:

==================
pw_sys_io_particle
==================
Particle Device OS backend for :ref:`module-pw_sys_io`.

This module provides low-level I/O over USB CDC serial, enabling console
output and input via ``particle serial monitor``.

-----
Setup
-----
Configure the backend in your project's label flags:

.. code-block:: python

   # In .bazelrc or BUILD
   "--@pigweed//pw_sys_io:backend=@particle_bazel//pw_sys_io_particle:sys_io",

-----
Usage
-----
The backend is typically used indirectly through ``pw_log`` for output:

.. code-block:: cpp

   #include "pw_log/log.h"

   PW_LOG_INFO("Hello from Particle!");

For direct I/O (rare):

.. code-block:: cpp

   #include "pw_sys_io/sys_io.h"

   // Write a line (includes CRLF)
   pw::sys_io::WriteLine("Debug output");

   // Read a byte (blocks until available)
   std::byte input;
   pw::sys_io::ReadByte(&input);

   // Non-blocking read
   if (pw::sys_io::TryReadByte(&input).ok()) {
     // Got a byte
   }

---------------
Viewing Output
---------------
Connect to the serial output using the Particle CLI:

.. code-block:: bash

   particle serial monitor

Or with any serial terminal at 115200 baud on the USB serial port.

-----------------------
Implementation Details
-----------------------
- Uses USB CDC serial (``HAL_USB_USART_SERIAL``)
- Baud rate: 115200 (configurable in USB stack, but typically fixed)
- Auto-initialized on first use
- Thread-safe: Writes are protected by a recursive mutex for atomic log lines
- ``ReadByte()`` busy-waits until data is available
- ``WriteLine()`` appends CRLF automatically

.. note::

   The USB serial is the same interface used by Device OS for diagnostics.
   It remains available even when your application is running.

----------
Bazel Targets
----------
- ``//pw_sys_io_particle:sys_io`` - USB serial I/O backend
