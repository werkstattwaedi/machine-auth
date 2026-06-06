# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Firestore-driven label print worker.

The admin web app renders a label and builds the Brother raster bytes
client-side, then writes a `queued` doc to the `printJobs` collection. This
worker — running on the on-LAN gateway with a Firestore service account —
watches for queued jobs via a snapshot listener, claims each one
atomically, sends the bytes to the printer, and writes the terminal status
(+ German error) back to the doc, which the admin UI awaits.

This keeps the only Firebase-facing privilege on the gateway (already a
trusted box) instead of embedding a printer relay or secret in every admin
machine. See the printing-via-gateway plan.

The `google-cloud-firestore` import is deferred to :meth:`run` so a gateway
deployment without a printer configured never needs the dependency.
"""

import asyncio
import base64
import logging
from concurrent.futures import TimeoutError as FutureTimeoutError
from typing import Optional

from .printer import (
    CONNECT_TIMEOUT_S,
    POST_WRITE_LINGER_S,
    PrinterError,
    send_to_printer,
)

logger = logging.getLogger(__name__)

PRINT_JOBS_COLLECTION = "printJobs"

# Upper bound for waiting on the async printer send from the Firestore SDK
# callback thread. Must exceed the worst-case connect + linger so a hung
# socket (e.g. half-open connection) can never stall the callback thread —
# and with it all subsequent snapshot deliveries — indefinitely.
PRINT_RESULT_TIMEOUT_S = CONNECT_TIMEOUT_S + POST_WRITE_LINGER_S + 5.0


class PrintWorker:
    """Watches `printJobs` for queued jobs and drives the label printer."""

    def __init__(
        self,
        printer_host: str,
        printer_port: int,
        project: Optional[str] = None,
    ) -> None:
        self._host = printer_host
        self._port = printer_port
        self._project = project
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._db = None
        self._watch = None

    async def run(self) -> None:
        """Register the Firestore listener and block until cancelled."""
        self._loop = asyncio.get_running_loop()

        # Deferred import: only printer-equipped gateways need the SDK.
        from google.cloud import firestore  # type: ignore
        from google.cloud.firestore_v1.base_query import FieldFilter

        # The client honours FIRESTORE_EMULATOR_HOST (dev, anonymous creds)
        # and GOOGLE_APPLICATION_CREDENTIALS (prod service account)
        # automatically.
        self._db = (
            firestore.Client(project=self._project)
            if self._project
            else firestore.Client()
        )

        self._recover_orphaned_jobs()

        query = self._db.collection(PRINT_JOBS_COLLECTION).where(
            filter=FieldFilter("status", "==", "queued")
        )
        logger.info(
            "Print worker: listening for queued jobs → printer %s:%d",
            self._host,
            self._port,
        )
        self._watch = query.on_snapshot(self._on_snapshot)

        try:
            await asyncio.Event().wait()  # run until the task is cancelled
        finally:
            if self._watch is not None:
                self._watch.unsubscribe()

    def _recover_orphaned_jobs(self) -> None:
        """Mark jobs left in `printing` at startup as errored.

        Single-gateway assumption: only this process ever advances a job from
        `printing` to a terminal state, so any job still `printing` when we
        boot was orphaned by a previous crash/restart mid-print. Without this,
        such a job never re-enters the `queued` listener and sits until the 1h
        TTL — the admin UI just times out with a misleading "printer
        unreachable". Reset them so the operator gets a clear signal instead.
        """
        from google.cloud.firestore_v1.base_query import FieldFilter

        try:
            stuck = (
                self._db.collection(PRINT_JOBS_COLLECTION)
                .where(filter=FieldFilter("status", "==", "printing"))
                .stream()
            )
            for doc in stuck:
                doc.reference.update(
                    {
                        "status": "error",
                        "error": "Druck unterbrochen (Gateway neu gestartet)",
                    }
                )
                logger.warning(
                    "Print job %s: recovered orphaned 'printing' job → error",
                    doc.id,
                )
        except Exception:  # noqa: BLE001 — never let recovery block startup
            logger.exception("Print worker: orphaned-job recovery failed")

    def _on_snapshot(self, docs, changes, read_time) -> None:
        """Snapshot callback (runs in a Firestore SDK background thread)."""
        for doc in docs:
            data = doc.to_dict() or {}
            if data.get("status") != "queued":
                continue
            try:
                self._process_job(doc.reference)
            except Exception:  # noqa: BLE001 — never let one job kill the listener
                logger.exception("Print worker: failed processing job %s", doc.id)

    def _process_job(self, ref) -> None:
        from google.cloud import firestore  # type: ignore

        # Claim atomically (queued → printing) so a snapshot re-delivery on
        # reconnect can't print the same job twice.
        @firestore.transactional
        def claim(transaction) -> bool:
            snap = ref.get(transaction=transaction)
            if (snap.to_dict() or {}).get("status") != "queued":
                return False
            transaction.update(ref, {"status": "printing"})
            return True

        if not claim(self._db.transaction()):
            return

        job = ref.get().to_dict() or {}
        try:
            payload = base64.b64decode(job.get("bytesB64", ""), validate=True)
        except Exception:  # noqa: BLE001
            ref.update({"status": "error", "error": "Ungültige Druckdaten"})
            logger.warning("Print job %s: invalid base64 payload", ref.id)
            return

        future = asyncio.run_coroutine_threadsafe(
            send_to_printer(self._host, self._port, payload), self._loop
        )
        try:
            # Bounded wait: never block this (shared, serialized) Firestore
            # callback thread on a hung socket beyond the worst case.
            bytes_sent = future.result(timeout=PRINT_RESULT_TIMEOUT_S)
            ref.update({"status": "done", "error": None})
            logger.info("Print job %s: done (%d bytes)", ref.id, bytes_sent)
        except PrinterError as exc:
            ref.update({"status": "error", "error": str(exc)})
            logger.warning("Print job %s: printer error: %s", ref.id, exc)
        except FutureTimeoutError:
            future.cancel()
            ref.update(
                {
                    "status": "error",
                    "error": "Drucker nicht erreichbar (Zeitüberschreitung)",
                }
            )
            logger.warning("Print job %s: print timed out", ref.id)
        except Exception:  # noqa: BLE001
            ref.update({"status": "error", "error": "Druckfehler"})
            logger.exception("Print job %s: unexpected error", ref.id)
