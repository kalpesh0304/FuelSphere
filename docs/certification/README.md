# SAP certification pack — BTP-EXT-S/4PUB (Cert ID 26150)

| File | For SAP step | Status |
|---|---|---|
| `FuelSphere_Solution_Architecture_L2.png` / `.svg` / `.drawio` | 1. Solution integration architecture | Draft. Redraw the icons with the official SAP BTP draw.io library |
| `FuelSphere_TPP_BTP-APP_v1.73.docx` | 2. BTP-APP TPP | Filled on SAP's template. The yellow items need input from Diligent |
| `FuelSphere_TPP_Supplementary_BTP-EXT-S4PUB_v1.73.docx` | 2. Supplementary TPP | Filled. The yellow items need input |
| `FuelSphere_S4PUB_Technical_Integration.md` | 2. Supporting: technical integration document | Draft |
| `FuelSphere_Installation_and_Configuration.md` | 2. Supporting: installation document | Draft |
| `FuelSphere_Certification_Readiness_Gaps.md` | Internal. **Do not send to SAP** | Gaps to close before integration testing |
| `_generator/` | Regenerates the diagram and the filled TPPs from SAP's blank templates | `python3 fill.py <app.docx> <sup.docx> <outdir> <png>` |

**Local only, not in git:** the two `.docx` TPPs, the gap report and `_generator/fill.py`. They reproduce SAP's confidential template or list open security gaps, and this repository is public. They are excluded through `.git/info/exclude`.

Every claim was checked against `main` at `6189e0b`. In the documents, blue text is the answer and yellow text is an `ACTION` or `TO BE PROVIDED` item.
