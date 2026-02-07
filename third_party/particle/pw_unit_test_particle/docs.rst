.. _module-pw_unit_test_particle:

=====================
pw_unit_test_particle
=====================
On-device test runner for :ref:`module-pw_unit_test` on Particle devices.

This module provides a ``main()`` function that runs Pigweed unit tests
on the device and outputs results via USB serial.

-----
Setup
-----
Use the ``particle_cc_test`` rule to create on-device tests:

.. code-block:: python

   load("@particle_bazel//rules:particle_test.bzl", "particle_cc_test")

   particle_cc_test(
       name = "my_test",
       srcs = ["my_test.cc"],
       deps = [
           "//my_library:target",
           "@pigweed//pw_unit_test",
       ],
   )

The rule automatically links in ``pw_unit_test_particle:main``.

-----
Usage
-----
Write tests using standard Pigweed unit test macros:

.. code-block:: cpp

   #include "pw_unit_test/framework.h"

   TEST(MyModule, BasicTest) {
     EXPECT_EQ(2 + 2, 4);
   }

   TEST(MyModule, AnotherTest) {
     ASSERT_TRUE(SomeFunction());
   }

Running Tests
=============
Build and flash the test firmware:

.. code-block:: bash

   bazel build --config=p2 //my_tests:my_test
   bazel run --config=p2 //my_tests:my_test_flash

Then connect to the serial monitor:

.. code-block:: bash

   particle serial monitor

The test runner waits for the USB serial connection before starting tests.
Results are printed with pass/fail status for each test.

Example Output
==============
.. code-block:: text

   [ RUN      ] MyModule.BasicTest
   [       OK ] MyModule.BasicTest
   [ RUN      ] MyModule.AnotherTest
   [       OK ] MyModule.AnotherTest
   [==========] Done running all tests.
   [  PASSED  ] 2 test(s).

   === ALL TESTS PASSED ===

-----
Behavior
-----
1. Waits for USB serial connection (user must open serial monitor)
2. Brief delay for terminal to stabilize (500ms)
3. Runs all registered tests via ``RUN_ALL_TESTS()``
4. Prints summary banner (``=== ALL TESTS PASSED ===`` or ``=== TESTS FAILED ===``)
5. Idles forever so user can see results

.. note::

   The test firmware idles after completion rather than resetting.
   Use Ctrl+C to exit the serial monitor, then reflash as needed.

-----------------------
Implementation Details
-----------------------
- Uses ``pw_unit_test::SimplePrintingEventHandler`` for output
- Output goes through ``pw_sys_io`` (USB CDC serial)
- Waits for ``HAL_USB_USART_Is_Connected()`` before starting
- Called from ``pigweed_entry.cc`` which maps Device OS ``setup()`` to ``main()``

----------
Bazel Targets
----------
- ``//pw_unit_test_particle:main`` - Test runner main function
