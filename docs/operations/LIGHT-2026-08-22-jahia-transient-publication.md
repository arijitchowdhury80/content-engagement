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
