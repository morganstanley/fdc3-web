# Contributing

Start with a conversation about your proposed change before opening a pull request. The complete project rules, contributor-code expectations and DCO process are in [CONTRIBUTING.md](https://github.com/morganstanley/fdc3-web/blob/main/CONTRIBUTING.md).

## Local development

```bash
npm ci

# Build all projects
npm run build

# Unit tests
npm test

# Lint
npm run lint

# Start the test harness
npm start
```

The docs site adds no runtime dependency to either published package. To work on it from the repo root:

```bash
npm run docs:dev
```

For a production docs build, including generated TypeDoc and a check that local Markdown routes resolve:

```bash
npm run docs:build
```

## Test the integration

The Playwright suite exercises FDC3 APIs across browser origins and starts the harness and directory servers for you:

```bash
npx playwright install chromium
npm run test:e2e
```

For a full CI-style release verification, including browser tests and lint:

```bash
npx playwright install --with-deps chromium
npm run build:release
```

Tests are not required for every prose-only change, but any code change should preserve the full checks. Use the [test-harness example](examples/host.md) to exercise cross-window and cross-origin behaviour while developing.

## Pull requests

- Keep interface documentation and relevant tests up to date.
- Remove generated build and dependency artifacts from your commit.
- Follow the DCO requirements, including a DCO reference and any required NOTICE updates.
- Get a passing build and another developer's review before merging.

The full contributing document explains the required Developer Certificate of Origin process and contains the project's Code of Conduct. Treat it as authoritative: this short page doesn't replace it.

## Project map

| Directory                 | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| projects/fdc3-web         | Core Desktop Agent library.                        |
| projects/ui-provider      | Resolver and channel-selector components.          |
| projects/test-harness     | Working apps and multi-origin development harness. |
| projects/test-harness-e2e | Playwright API and regression suite.               |
| docs/guides               | Concept and integration guides.                    |
| docs/examples             | Harness-derived walkthroughs.                      |
| site                      | Vite docs site and TypeDoc setup.                  |

## Open an issue

Use [GitHub issues](https://github.com/morganstanley/fdc3-web/issues) to report a problem or discuss an improvement. Read the [FINOS FDC3 documentation](https://fdc3.finos.org/) for the standard itself, and this repo's guides for the browser-specific setup.
