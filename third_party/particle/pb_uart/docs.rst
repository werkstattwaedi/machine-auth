.. _module-pb_uart:

=======
pb_uart
=======
Async UART implementation for Particle Device OS with ``pw_async2`` waker support.

-----
Setup
-----
This module requires:

- Particle Device OS with HAL USART support
- ``pw_async2`` for async futures and wakers
- ``pw_thread`` for background polling task

-----
Usage
-----
.. code-block:: cpp

   #include "pb_uart/async_uart.h"

   // Provide buffers (must be 32-byte aligned for DMA on RTL872x)
   alignas(32) static std::byte rx_buf[265];  // PN532 max frame ~262 bytes
   alignas(32) static std::byte tx_buf[265];

   // Create and initialize
   pb::AsyncUart uart(HAL_USART_SERIAL2, rx_buf, tx_buf);
   PW_TRY(uart.Init(115200));

   // Synchronous write
   uart.Write(pw::bytes::Array<0x00, 0x01, 0x02>());

   // In a coroutine - async read with waker support
   pw::async2::Coro<pw::Status> ReadData(pw::async2::CoroContext& cx) {
     std::array<std::byte, 64> buffer;
     auto result = co_await uart.Read(buffer, 4);  // Wait for 4 bytes
     PW_TRY(result.status());
     // Process result.size() bytes in buffer...
     co_return pw::OkStatus();
   }

------
Design
------
The async UART uses a background FreeRTOS task that polls ``hal_usart_available()``
at a configurable interval (default 1ms). When data arrives, the task wakes all
pending read futures via their wakers, allowing the dispatcher to resume the
waiting coroutines.

This approach is necessary because:

1. The Device OS HAL's event APIs (``hal_usart_pvt_*``) are internal-only
2. Direct interrupt registration would conflict with HAL's existing handlers
3. Only UART0/DMA (``HAL_USART_SERIAL2``) supports events anyway

The polling approach provides responsive I/O (1ms latency) while allowing
coroutines to properly yield to the dispatcher rather than busy-waiting.

-----------
Thread Safe
-----------
- ``Read()`` can be called from any thread/context
- ``Write()`` is synchronous and thread-safe via HAL
- Internal waker state is protected by ``pw::sync::Mutex``

-------
Testing
-------
The ``loopback_hardware_test`` requires a physical loopback connection:

For SERIAL2::

    D4 (TX) ↔ D5 (RX)

Run with::

    bazel run --config=p2 @particle_bazel//pb_uart:loopback_hardware_test_flash
