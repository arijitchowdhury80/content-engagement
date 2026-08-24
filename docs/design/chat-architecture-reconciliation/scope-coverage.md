# Stage 1 Scope Coverage

Frozen denominator: `scope-manifest.json` SHA-256 `8c0dec32909eaaeb1cee2ec7cd462250471495916d5200784b4e3ea216810e69`
Baseline manifest: SHA-256 `18918895efb32cadf5298daa7851969e94d1dd6274aa9aea7d61a5de8f39f530`

## Architecture denominator

| Baseline | Included | Dispositioned | Coverage |
|---|---:|---:|---:|
| `algolia-com` | 105 | 105 | 100% |
| `sajid-upstream` | 246 | 246 | 100% |
| `shared-integration` | 208 | 208 | 100% |
| **Total** | **559** | **559** | **100%** |

Coverage is grouped by coherent modules and file classes in the three Wave 1 reports. It establishes review disposition of the frozen denominator; it does not imply that current implementations pass the hard gates.

## Non-scoring classes

| Baseline | Artifact/runtime evidence | Excluded with reason |
|---|---:|---:|
| `algolia-com` | 1,683 | 203 |
| `sajid-upstream` | 0 | 24 |
| `shared-integration` | 950 | 30 |

Artifact/runtime evidence remains eligible to prove deployed behavior and housekeeping disposition, but cannot substitute for readable source when scoring ownership, maintainability, dependency enforcement, or reproducibility. Exclusions remain in housekeeping scope where relevant.

## Snapshot verification

All three snapshots were hash-verified after Wave 1:

- Algolia: 1,991/1,991 files; manifest `258732bcb33f1c4f9febf038d2ea2a4c56494a07abbd7536fde50d0866ceb5e6`.
- Sajid upstream: 270/270 files; manifest `469f6bf0753f8d542e041dca06bfd39b6ce2b5ff012bc8298b46055f287b14de`.
- Shared integration: 1,188/1,188 files; manifest `74fb8fe1b8372ae8dc45fa8b1ea09c8f06485d6e134609b1ecb810bb39d2b619`.

No scope amendment has been made.
