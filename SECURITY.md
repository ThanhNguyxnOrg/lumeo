# Security Policy

## Supported Versions

The `main` branch is currently the supported version.

## Reporting a Vulnerability

Please do **not** open public issues for security reports.

Report privately via email:

- **Contact:** thanhnguyentuan2007@gmail.com
- **Subject:** `[Lumeo][Security] <short summary>`

Include:

1. Vulnerability type and impact
2. Steps to reproduce
3. Proof of concept (if safe)
4. Suggested mitigation

## Security Best Practices

- Never commit API keys, PATs, or session tokens
- Validate all postMessage payloads and origins
- Keep host permissions minimal in `manifest.json`
- Revoke compromised credentials immediately
