from __future__ import annotations

import pytest

from algolia_enrichment.errors import EnrichmentError
from algolia_enrichment.waits import wait_or_fail


class Client:
    def __init__(self, published: bool):
        self._published = published
        self.calls = []

    def wait_task(self, index, task_id, timeout_s=120):
        self.calls.append((index, task_id))
        return self._published


def test_a_published_task_passes_through():
    client = Client(published=True)
    wait_or_fail(client, "idx", 42, "write")
    assert client.calls == [("idx", 42)]


def test_a_task_that_never_publishes_raises_instead_of_returning_false():
    """wait_task returns False on timeout. Ignoring that return makes a timed-out write
    indistinguishable from a successful one -- and the very next step DELETES records on the
    assumption that the write landed. Silence here costs data."""
    with pytest.raises(EnrichmentError) as exc:
        wait_or_fail(Client(published=False), "idx", 42, "write")
    assert "did not publish" in str(exc.value).lower()


def test_the_error_names_the_operation_and_the_task():
    with pytest.raises(EnrichmentError) as exc:
        wait_or_fail(Client(published=False), "Algolia_Prod_Copy_Enhanced", 99, "quarantine copy")
    message = str(exc.value)
    assert "quarantine copy" in message
    assert "Algolia_Prod_Copy_Enhanced" in message
    assert "99" in message
