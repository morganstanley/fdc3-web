# Morgan Stanley GitHub Pages Documentation Gatsby Theme

## Creating a documentation site for your project

### Prerequisites

Ensure that the appropriate version of `node` and `npm` is available in your workspace. Please refer to the `engines` attribute of the `package.json` for the current expected version.

### Personal Access Token for GitHub Packages

To build the site locally, you will need to generate a personal access token and add it to your `.npmrc`.

```
//npm.pkg.github.com/:_authToken=ghp_<token goes here>
@morganstanley:registry=https://npm.pkg.github.com/
```

[Authenticating to GitHub Packages](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-to-github-packages)

### Template starter site

Copy and paste the `site/` directory of the `ms-gh-pages` project into the root of your project then update the `siteMetadata` key in the `gatsby-config.js` file to match your project's information.

```json
siteMetadata: {
    title: `Project GitHub Pages Template`, // your project's name
    description: `Morgan Stanley Open Source Software`, // your project's description
    siteUrl: `http://opensource.morganstanley.com`, // your project's url
}
```

### Development Preview Server

Go to http://localhost:8000 for the development preview of the website.

```shell
cd site
npm install
npm run start
```

### Update the Content

Update the appropriate files located in the `site/content` directory with documentation for your project. For instance, to change the homepage text, update the `site/content/index.mdx`. Please be sure to _replace the content of each file in at least `/index.mdx` and `/documentation`_ to ensure a consistent experience across the Firm's Open Source projects.

```
/
--/site
----/content
------/architecture - directory linked in header navigation
--------index.mdx -> architecture landing page
------/documentation - directory linked in header navigation
--------index.mdx -> documentation landing page
------index.mdx -> Site Homepage
```

### Dependabot

The Morgan Stanley GitHub page documentation theme is a package that can be updated via Dependabot. Because its a private package, Dependabot will need to be given permission through a token. Update your project's `.github/dependabot.yml` with:

```yaml
registries:
  npm-ghp:
    type: npm-registry
    url: 'https://npm.pkg.github.com'
    token: ${{ secrets.GITHUB_TOKEN }}
```

Please refer to the [Dependabot Documentation](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/configuring-access-to-private-registries-for-dependabot).
