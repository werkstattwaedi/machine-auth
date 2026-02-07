.. _module-pw_spi_particle:

================
pw_spi_particle
================
Particle Device OS SPI initiator implementation for :ref:`module-pw_spi`.

This module provides an SPI initiator using DMA transfers through the
Device OS HAL.

-----
Setup
-----
Add the dependency to your BUILD.bazel:

.. code-block:: python

   deps = [
       "@particle_bazel//pw_spi_particle:initiator",
       "@pigweed//pw_spi:initiator",
   ],

-----
Usage
-----
.. code-block:: cpp

   #include "pb_spi/initiator.h"
   #include "pw_spi/chip_selector_digital_out.h"

   // Create SPI initiator on SPI1 interface at 1 MHz
   pb::ParticleSpiInitiator spi(pb::ParticleSpiInitiator::Interface::kSpi1,
                                 1'000'000);

   // Chip select using a GPIO pin
   pb::ParticleDigitalOut cs_pin(D6);
   cs_pin.Enable();
   pw::spi::DigitalOutChipSelector cs(cs_pin);

   void TransferData() {
     std::array<std::byte, 4> tx_data = {...};
     std::array<std::byte, 4> rx_data;

     // Acquire CS, transfer, release CS
     {
       auto device = pw::spi::Device(spi, cs, spi_config);
       device.WriteRead(tx_data, rx_data);
     }
   }

SPI Interfaces
==============
.. cpp:enum-class:: pb::ParticleSpiInitiator::Interface

   .. cpp:enumerator:: kSpi

      Primary SPI (``HAL_SPI_INTERFACE1``). Pins: A3 (SCK), A4 (MISO), A5 (MOSI)

   .. cpp:enumerator:: kSpi1

      Secondary SPI (``HAL_SPI_INTERFACE2``). Pins: D4 (SCK), D3 (MISO), D2 (MOSI)

   .. cpp:enumerator:: kSpi2

      Tertiary SPI (``HAL_SPI_INTERFACE3``). Check device pinout for availability.

Chip Select
===========
This initiator does **not** manage chip select (CS) internally. Use
``pw::spi::DigitalOutChipSelector`` or manual GPIO control:

.. code-block:: cpp

   // Using Pigweed's chip selector wrapper
   pb::ParticleDigitalOut cs_gpio(D6);
   cs_gpio.Enable();
   pw::spi::DigitalOutChipSelector chip_select(cs_gpio);

   // Manual control
   cs_gpio.SetState(pw::digital_io::State::kInactive);  // CS high (deselected)
   // ... setup ...
   cs_gpio.SetState(pw::digital_io::State::kActive);    // CS low (selected)
   spi.WriteRead(tx, rx);
   cs_gpio.SetState(pw::digital_io::State::kInactive);  // CS high (deselected)

-----------------------
Implementation Details
-----------------------
- Uses Device OS HAL: ``hal_spi_*`` functions with DMA
- DMA transfers are asynchronous with semaphore-based completion
- Only one initiator per SPI interface allowed (static instance registry)
- Clock frequency is rounded down to nearest available divider
- Supports SPI modes 0-3 via ``pw::spi::Config``
- MSB-first bit order (standard)

DMA Callbacks
=============
The HAL SPI DMA callback doesn't provide user context, so this implementation
uses a static registry to map interface index to initiator instance. This
means:

- Only one ``ParticleSpiInitiator`` per interface at a time
- Creating a second initiator for the same interface will fail

---------------
Hardware Test
---------------
A loopback test is available. Requires MOSI->MISO wire connection on SPI1
(D3 -> D2):

.. code-block:: bash

   bazel build --config=p2 @particle_bazel//pw_spi_particle:loopback_test
   bazel run --config=p2 @particle_bazel//pw_spi_particle:loopback_test_flash

----------
Bazel Targets
----------
- ``//pw_spi_particle:initiator`` - SPI initiator with DMA
- ``//pw_spi_particle:loopback_test`` - Hardware loopback test
