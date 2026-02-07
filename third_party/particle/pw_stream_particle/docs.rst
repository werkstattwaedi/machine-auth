.. _module-pw_stream_particle:

==================
pw_stream_particle
==================
Particle Device OS UART stream implementation for :ref:`module-pw_stream`.

This module provides a non-blocking UART stream wrapper using the Device OS
HAL, suitable for communication with peripherals like the PN532 NFC reader.

-----
Setup
-----
Add the dependency to your BUILD.bazel:

.. code-block:: python

   deps = [
       "@particle_bazel//pw_stream_particle:uart_stream",
       "@pigweed//pw_stream",
   ],

-----
Usage
-----
.. code-block:: cpp

   #include "pb_stream/uart_stream.h"

   // Create UART stream on Serial1 (pins D8/TX, D9/RX)
   pb::ParticleUartStream uart(HAL_USART_SERIAL1);

   void Setup() {
     uart.Init(115200);  // Initialize with baud rate
   }

   void SendData() {
     std::array<std::byte, 4> data = {std::byte{0x01}, std::byte{0x02},
                                       std::byte{0x03}, std::byte{0x04}};
     uart.Write(data);
     uart.Flush();  // Wait for transmission complete
   }

   void ReceiveData() {
     std::array<std::byte, 64> buffer;
     auto result = uart.Read(buffer);

     if (result.ok()) {
       size_t bytes_read = result.size();
       // Process buffer[0..bytes_read-1]
     }
   }

Non-Blocking Reads
==================
The key feature of this stream is **non-blocking reads**: ``Read()`` returns
immediately with whatever bytes are available (0 if none). This enables
polling-based async I/O patterns:

.. code-block:: cpp

   // Poll for response with timeout
   auto deadline = pw::chrono::SystemClock::now() + 100ms;
   while (pw::chrono::SystemClock::now() < deadline) {
     auto result = uart.Read(buffer);
     if (result.ok() && result.size() > 0) {
       // Got data!
       break;
     }
     pw::this_thread::yield();
   }

Available UARTs
===============
.. list-table::
   :header-rows: 1

   * - Interface
     - HAL Constant
     - TX Pin
     - RX Pin
   * - Serial1
     - ``HAL_USART_SERIAL1``
     - D8 (TX)
     - D9 (RX)
   * - Serial2
     - ``HAL_USART_SERIAL2``
     - D4 (TX)
     - D5 (RX)

-----------------------
Implementation Details
-----------------------
- Uses Device OS HAL: ``hal_usart_init()``, ``hal_usart_write()``,
  ``hal_usart_read()``
- Buffer size: 64 bytes (matches Device OS ``SERIAL_BUFFER_SIZE``)
- Non-blocking reads via ``hal_usart_available_data()`` + ``hal_usart_read()``
- Writes are blocking (waits for TX buffer space)
- ``Flush()`` waits for TX buffer to empty
- Must call ``Init()`` before use; ``Deinit()`` to release

---------------
Hardware Test
---------------
A loopback test is available for verifying the UART hardware. Requires
crossover wiring between Serial1 and Serial2:

- D8/TX (Serial1 TX) -> D5 (Serial2 RX)
- D4 (Serial2 TX) -> D9/RX (Serial1 RX)

.. code-block:: bash

   bazel build --config=p2 @particle_bazel//pw_stream_particle:loopback_test
   bazel run --config=p2 @particle_bazel//pw_stream_particle:loopback_test_flash

----------
Bazel Targets
----------
- ``//pw_stream_particle:uart_stream`` - UART stream implementation
- ``//pw_stream_particle:loopback_test`` - Hardware loopback test
