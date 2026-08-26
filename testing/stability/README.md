# Stability Test System

This directory contains the authoritative, synthetic, end-to-end stability test harness for the
Algolia.com development concierge.

The only permitted hosted target is `https://tmp-content-eng-algolia.cloud.jahia.com`, using app
`0EXRPAXB56`, agent `www Chat - Orchestrator`, and index `Algolia_Prod_Copy_Vanilla`. Production Ask
Algolia is never a load or mutation target.

Raw traces, screenshots, videos, network archives, storage snapshots, and Agent Studio exports must
be written outside this repository and outside Dropbox or any other synchronized directory. The CLI
rejects unsafe artifact paths.

Current commands:

```bash
npm run test:stability
npm run stability -- validate-dataset \
  --dataset testing/stability/datasets/reactive-conversations.v1.json
npm run stability -- validate-adaptive-dataset \
  --dataset testing/stability/datasets/adaptive-discovery.v1.json
npm run stability -- adaptive-discovery --campaign U2-AD1 --out /private/tmp/algolia-adaptive-discovery
```

The fixed reactive corpus is the mechanical stress lane. It does not certify discovery quality.
The adaptive lane answers the assistant's actual follow-up from hidden persona facts and separately
grades repeated slots, question drift, profile completeness, final fact use, and specialist routing.

Additional fixture, preflight, execution, reconciliation, and report commands are added by later
qualified increments. Unsupported commands fail closed.

Operator conversation retrieval uses an ordinary Algolia API key with the `logs` ACL. The harness
accepts `ALGOLIA_LOGS_API_KEY` when a least-privilege key is available and otherwise uses the existing
operator-side `ALGOLIA_ADMIN_API_KEY`. Neither key is exposed to browser code or written to evidence.
