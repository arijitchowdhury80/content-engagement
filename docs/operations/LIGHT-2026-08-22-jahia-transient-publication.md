# Jahia transient publication and rollback

Observed during the Compare integration deployment: a newly created
`jcr:content` node briefly returned `PathNotFoundException`, and the immediate
rollback hit `InvalidItemStateException` even though later readback showed the
node and a retry restored the block exactly.

Prevention heuristic: retry `PathNotFoundException` only for a newly created
asset publication. A full-block `InvalidItemStateException` may be a real
concurrent edit, so every retry must first re-read EDIT/LIVE and validate the
approved hashes. In all cases, prove the intended EDIT/LIVE bytes by readback;
never treat a one-shot GraphQL response as the deployment result.

The public CDN is a second eventual-consistency boundary. A just-published
immutable URL can briefly return 404 even after EDIT/LIVE JCR hashes match.
Public-byte validation therefore retries only 404, 5xx, and transport failures
within a fixed window; permission failures remain immediate, and deployment
still succeeds only on the exact expected SHA.
