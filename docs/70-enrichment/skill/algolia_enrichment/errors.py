"""Typed failures. Every one exits non-zero. No command prints PASS on zero rows."""


class EnrichmentError(RuntimeError):
    """Base. Anything raised here aborts the command."""


class StateError(EnrichmentError):
    """Illegal state transition."""


class LockError(EnrichmentError):
    """Run folder is locked by another process."""


class ApprovalError(EnrichmentError):
    """Missing, stale, or mismatched approval token."""


class ZeroWorkError(EnrichmentError):
    """Checked nothing. This is a failure, never a pass."""


class ProfileError(EnrichmentError):
    """Unknown or incomplete source/page_type profile."""
