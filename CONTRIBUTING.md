# Contributing Guide

Thanks for contributing to **Lumen Subtitle Studio**.

## Development Setup

1. Fork and clone this repo.
2. Create a feature branch:
   ```bash
   git checkout -b feat/short-description
   ```
3. Load unpacked extension in Chrome (`chrome://extensions`).
4. Test your change on real YouTube watch pages.

## Pull Request Rules

- Keep PRs focused and small.
- Include reproduction steps and verification notes.
- If UI is changed, include screenshots/GIF.
- Do not commit API keys, tokens, or personal credentials.

## Commit Convention

Preferred style:

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `chore: ...`

## Quality Checklist

Before opening PR:

- [ ] No sensitive data in source or logs
- [ ] Extension loads successfully in Chrome
- [ ] Core subtitle flow still works
- [ ] README/changelog updated if behavior changed

## Reporting Bugs

Open an issue with:

- Environment (Chrome version, OS)
- Steps to reproduce
- Expected vs actual behavior
- Console errors (content + service worker)
