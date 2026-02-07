.. _module-pw_sync_particle:

=================
pw_sync_particle
=================
Particle Device OS backend for :ref:`module-pw_sync`.

This module provides synchronization primitives using the FreeRTOS primitives
exposed through Device OS's concurrent HAL.

-----
Setup
-----
Configure the backends in your project's label flags:

.. code-block:: python

   # In .bazelrc or BUILD
   "--@pigweed//pw_sync:mutex_backend=@particle_bazel//pw_sync_particle:mutex",
   "--@pigweed//pw_sync:timed_mutex_backend=@particle_bazel//pw_sync_particle:timed_mutex",
   "--@pigweed//pw_sync:binary_semaphore_backend=@particle_bazel//pw_sync_particle:binary_semaphore",
   "--@pigweed//pw_sync:counting_semaphore_backend=@particle_bazel//pw_sync_particle:counting_semaphore",
   "--@pigweed//pw_sync:thread_notification_backend=@particle_bazel//pw_sync_particle:thread_notification",
   "--@pigweed//pw_sync:timed_thread_notification_backend=@particle_bazel//pw_sync_particle:timed_thread_notification",
   "--@pigweed//pw_sync:interrupt_spin_lock_backend=@particle_bazel//pw_sync_particle:interrupt_spin_lock",

-----
Mutex
-----
Basic mutex without timeout support. Uses Device OS ``os_mutex_*`` functions.

.. code-block:: cpp

   #include "pw_sync/mutex.h"

   pw::sync::Mutex mutex;

   void CriticalSection() {
     std::lock_guard lock(mutex);
     // Protected code...
   }

-----------
Timed Mutex
-----------
Mutex with timeout support for ``try_lock_for()`` and ``try_lock_until()``.

.. code-block:: cpp

   #include "pw_sync/timed_mutex.h"

   pw::sync::TimedMutex timed_mutex;

   void TryLockWithTimeout() {
     if (timed_mutex.try_lock_for(100ms)) {
       // Got the lock
       timed_mutex.unlock();
     }
   }

----------------
Binary Semaphore
----------------
Semaphore with maximum count of 1. Useful for signaling between threads
or from ISRs.

.. code-block:: cpp

   #include "pw_sync/binary_semaphore.h"

   pw::sync::BinarySemaphore signal;

   void ProducerThread() {
     // Signal that work is ready
     signal.release();
   }

   void ConsumerThread() {
     // Wait for signal (with timeout)
     if (signal.try_acquire_for(1s)) {
       // Process work...
     }
   }

------------------
Counting Semaphore
------------------
Semaphore with configurable maximum count. Useful for resource pools.

.. code-block:: cpp

   #include "pw_sync/counting_semaphore.h"

   // Pool of 3 resources
   pw::sync::CountingSemaphore pool(3);

   void UseResource() {
     pool.acquire();  // Blocks until resource available
     // Use resource...
     pool.release();
   }

-------------------
Thread Notification
-------------------
Lightweight single-thread notification mechanism. More efficient than
semaphores when only one thread waits.

.. code-block:: cpp

   #include "pw_sync/thread_notification.h"

   pw::sync::ThreadNotification notification;

   void WaitingThread() {
     notification.acquire();  // Block until notified
     // Proceed...
   }

   void NotifyingThread() {
     notification.release();  // Wake the waiting thread
   }

-------------------------
Timed Thread Notification
-------------------------
Thread notification with timeout support.

.. code-block:: cpp

   #include "pw_sync/timed_thread_notification.h"

   pw::sync::TimedThreadNotification notification;

   void WaitWithTimeout() {
     if (notification.try_acquire_for(500ms)) {
       // Notified within timeout
     } else {
       // Timeout expired
     }
   }

-------------------
Interrupt Spin Lock
-------------------
Lock for protecting data accessed from both threads and ISRs. Disables
interrupts while held.

.. code-block:: cpp

   #include "pw_sync/interrupt_spin_lock.h"

   pw::sync::InterruptSpinLock isr_lock;
   volatile int shared_counter = 0;

   void IncrementFromThread() {
     std::lock_guard lock(isr_lock);
     shared_counter++;
   }

   void IncrementFromIsr() {
     std::lock_guard lock(isr_lock);
     shared_counter++;
   }

.. warning::

   Keep critical sections short. Interrupts are disabled while the lock is held.

-----------------------
Implementation Details
-----------------------
- **Mutex**: Uses ``os_mutex_create()``, ``os_mutex_lock()``, ``os_mutex_unlock()``
- **Semaphores**: Uses ``os_semaphore_create()``, ``os_semaphore_take()``,
  ``os_semaphore_give()``
- **Thread Notification**: Uses interrupt spin lock internally with
  ``os_semaphore_*`` for the actual wait
- **Interrupt Spin Lock**: Uses ``os_interrupt_disable()`` /
  ``os_interrupt_restore()`` (PRIMASK on Cortex-M33)
- Timeouts are converted to milliseconds for Device OS APIs
- Very long timeouts are handled by looping with chunked waits

----------
Bazel Targets
----------
- ``//pw_sync_particle:mutex`` - Basic mutex
- ``//pw_sync_particle:timed_mutex`` - Mutex with timeout
- ``//pw_sync_particle:binary_semaphore`` - Binary semaphore
- ``//pw_sync_particle:counting_semaphore`` - Counting semaphore
- ``//pw_sync_particle:thread_notification`` - Thread notification
- ``//pw_sync_particle:timed_thread_notification`` - Timed thread notification
- ``//pw_sync_particle:interrupt_spin_lock`` - ISR-safe spin lock
