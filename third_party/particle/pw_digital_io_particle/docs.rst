.. _module-pw_digital_io_particle:

======================
pw_digital_io_particle
======================
Particle Device OS implementation for :ref:`module-pw_digital_io`.

This module provides GPIO wrappers using the Arduino Wiring-compatible HAL
functions, exposed through Pigweed's ``pw_digital_io`` interface.

.. note::

   This is **not** a facade backend. Instead, it provides concrete
   implementations in the ``pb::`` namespace that implement the
   ``pw::digital_io`` interfaces.

-----
Setup
-----
Add the dependency to your BUILD.bazel:

.. code-block:: python

   deps = [
       "@particle_bazel//pw_digital_io_particle:digital_io",
       "@pigweed//pw_digital_io",
   ],

-----
Usage
-----

Digital Output
==============
Control an output pin (e.g., LED):

.. code-block:: cpp

   #include "pb_digital_io/digital_io.h"
   #include "pw_digital_io/digital_io.h"

   // D7 is the onboard LED on Particle devices
   pb::ParticleDigitalOut led(D7);

   void Setup() {
     led.Enable();
   }

   void TurnOn() {
     led.SetState(pw::digital_io::State::kActive);
   }

   void TurnOff() {
     led.SetState(pw::digital_io::State::kInactive);
   }

Digital Input
=============
Read an input pin (e.g., button):

.. code-block:: cpp

   #include "pb_digital_io/digital_io.h"

   // Input with internal pull-down resistor
   pb::ParticleDigitalIn button(D0, pb::ParticleDigitalIn::Mode::kInputPulldown);

   void Setup() {
     button.Enable();
   }

   void CheckButton() {
     auto result = button.GetState();
     if (result.ok() && result.value() == pw::digital_io::State::kActive) {
       // Button is pressed
     }
   }

Input Modes
-----------
.. cpp:enum-class:: pb::ParticleDigitalIn::Mode

   .. cpp:enumerator:: kInput

      Floating input (no pull resistor). Use with external pull-up/down.

   .. cpp:enumerator:: kInputPullup

      Input with internal pull-up resistor. Active-low logic.

   .. cpp:enumerator:: kInputPulldown

      Input with internal pull-down resistor. Active-high logic.

Digital Input/Output
====================
Bidirectional pin (can switch between input and output):

.. code-block:: cpp

   #include "pb_digital_io/digital_io.h"

   pb::ParticleDigitalInOut bidir_pin(D3);

   void UseAsOutput() {
     bidir_pin.Enable();
     bidir_pin.SetState(pw::digital_io::State::kActive);
   }

   void ReadBack() {
     auto state = bidir_pin.GetState();
   }

-----------------------
Implementation Details
-----------------------
- Uses Device OS HAL: ``HAL_Pin_Mode()``, ``HAL_GPIO_Write()``, ``HAL_GPIO_Read()``
- Pin numbers use Device OS definitions (``D0``, ``D7``, ``A0``, etc.)
- ``Enable()`` must be called before use (configures pin mode)
- ``Disable()`` currently has no effect (pins remain configured)
- State mapping: ``kActive`` = HIGH, ``kInactive`` = LOW

----------
Bazel Targets
----------
- ``//pw_digital_io_particle:digital_io`` - GPIO wrapper classes
