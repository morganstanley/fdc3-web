# fdc3-web docs site

A Vite single-page site for the guides in `../docs`. TypeDoc's Markdown output is generated from `projects/fdc3-web/src/index.ts` before every production build.

```bash
npm ci
npm run docs:dev
```

The development URL is printed by Vite. Use the production build for link validation and a deployable `site/dist` directory:

```bash
npm run docs:build
npm run docs:preview
```

The base path defaults to `/fdc3-web/` for the repository's GitHub Pages URL. Set the `DOCS_BASE` environment variable to publish the site at a different path. `.github/workflows/docs-site.yml` configures and deploys the default path after a push to `main`. A repo admin must select **GitHub Actions** as the Pages source before the first deployment.

The site's brand palette follows Morgan Stanley's published design-system blues: Blue `#187ABA`, Navy `#002B51` and their 20%, 40% and 80% tones. Source content lives in `docs/`; `site/src/api/` is generated and never committed.
