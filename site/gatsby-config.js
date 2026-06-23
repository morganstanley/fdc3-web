module.exports = {
  siteMetadata: {
    title: `FDC3 Web`,
    description: `NPM library providing FDC3 capabilities`,
    siteUrl: 'http://opensource.morganstanley.com/fdc3-web',
    documentationUrl: false,
  },
  pathPrefix: `/fdc3-web`, // put GitHub project url slug here e.g. github.com/morganstanley/<project url slug>
  plugins: [
    {
      resolve: '@morganstanley/gatsby-theme-ms-gh-pages',
      options: {
        indexContent: './content',
      },
    },
  ],
};
