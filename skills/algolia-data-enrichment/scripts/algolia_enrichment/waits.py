"""Turn Algolia's asynchronous indexing into something a pipeline can rely on.

Algolia acknowledges a write immediately and applies it later, so a run that does not wait reads
back the OLD state and concludes its own write failed. `AlgoliaClient.wait_task` polls until the
task reports published -- but it signals a timeout by RETURNING FALSE, and a boolean nobody
inspects is the same as no check at all.

That matters most in the refresh, where the step immediately after a write is a DELETE. If the
write silently timed out and the delete proceeded anyway, records would be removed on the
strength of a write that never landed. Here a timeout is an error, named and raised.
"""

from __future__ import annotations

from .errors import EnrichmentError


def wait_or_fail(client, index: str, task_id: int, operation: str, timeout_s: int = 120) -> None:
    """Block until the task publishes; raise if it does not."""
    if not client.wait_task(index, task_id, timeout_s=timeout_s):
        raise EnrichmentError(
            f"{operation}: Algolia task {task_id} on {index!r} did not publish within "
            f"{timeout_s}s. The write is unconfirmed, so nothing downstream may assume it "
            f"landed -- refusing to continue rather than delete against an unverified write.")
