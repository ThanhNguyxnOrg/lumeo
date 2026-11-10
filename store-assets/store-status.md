# Marketplace listing status

Last verified: **2026-11-10**  
Release: **v2.0.9**

## Firefox Add-ons (AMO)

<badge>Public</badge>

- Listing: [Lumeo — Captions & AI Dub for YouTube](https://addons.mozilla.org/en-US/firefox/addon/lumeo-captions-ai-dub-for-yout/)
- Approved version: **2.0.9**
- Mozilla notified the publisher on 2026-11-10 that automated screening passed and the version was tentatively approved. Mozilla may still perform a human review and request changes.

## Microsoft Edge Add-ons

<badge>First publication pending</badge>

- There is no verified public Edge Add-ons listing URL yet.
- The v2.0.9 Edge ZIP is available from the [GitHub release](https://github.com/ThanhNguyxnOrg/lumeo/releases/tag/v2.0.9): `lumeo-v2.0.9-edge.zip`.
- The release workflow successfully uploaded the package to the Partner Center draft-package endpoint. Its subsequent submission request failed with `CreateNotAllowed` / “Can't create new extension.” This is not a certification rejection and does not mean the extension is public.
- Microsoft's first product/listing must be created and submitted manually in Partner Center. Once the first listing is published, subsequent package updates can use the Edge Add-ons API.
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
