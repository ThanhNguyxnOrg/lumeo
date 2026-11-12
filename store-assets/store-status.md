# Marketplace listing status

Last verified: **2026-11-12**  
Release: **v2.0.9**

## Firefox Add-ons (AMO)

**Status: Public**

- Listing: [Lumeo — Captions & AI Dub for YouTube](https://addons.mozilla.org/en-US/firefox/addon/lumeo-captions-ai-dub-for-yout/)
- Approved version: **2.0.9**
- Mozilla notified the publisher on 2026-11-10 that automated screening passed and the version was tentatively approved. Mozilla may still perform a human review and request changes.

## Microsoft Edge Add-ons

**Status: Public · Approved**

- The v2.0.9 Edge ZIP is available from the [GitHub release](https://github.com/ThanhNguyxnOrg/lumeo/releases/tag/v2.0.9): `lumeo-v2.0.9-edge.zip`.
- Listing: [Lumeo — Captions & AI Dub for YouTube](https://microsoftedge.microsoft.com/addons/detail/kpmmjnkccgpjbekgeiehbjonabdklhgj)
- Published listing confirmed on **2026-11-12**. The first listing is approved and publicly available.
- The earlier `CreateNotAllowed` response was a first-submission API limitation, not a certification rejection; it is now historical.
- Subsequent package updates can use the Edge Add-ons Update REST API. Keep `EDGE_PRODUCT_ID` specific to this repository.
- Partner Center: [Microsoft Edge Add-ons dashboard](https://partner.microsoft.com/dashboard/microsoftedge/public/login?ref=dd).

## Release workflow

- Firefox AMO submission is automated when `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` are configured.
- Edge package updates are API-based only after the first product has been created and published manually.
- A successful GitHub Release or package upload must never be treated as proof that a store listing is public.

## References

- [Firefox AMO listing](https://addons.mozilla.org/en-US/firefox/addon/lumeo-captions-ai-dub-for-yout/)
- [GitHub v2.0.9 release](https://github.com/ThanhNguyxnOrg/lumeo/releases/tag/v2.0.9)
- [GitHub release workflow run](https://github.com/ThanhNguyxnOrg/lumeo/actions/runs/42377135259)
- [Microsoft: Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- [Microsoft: Edge Add-ons Update REST API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api)
