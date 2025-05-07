const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

import 'webpack-dev-server';
import { resolve } from 'path';
import { Configuration } from 'webpack';

const buildConfig = (isRoot: boolean, isDev: boolean): Configuration => {
    const entry = isRoot ? 'root-app' : 'default-app';

    const plugins = isRoot
        ? [
              new HtmlWebpackPlugin({
                  filename: `root-app.html`,
                  template: resolve(__dirname, 'src', entry, `${entry}.html`),
                  scriptLoading: 'defer',
                  inject: 'body',
              }),
              new CopyPlugin({
                  patterns: [{ from: resolve(__dirname, 'src', 'assets'), to: 'assets' }],
              }),
          ]
        : [
              // 2 HtmlWebpackPlugin - one to create html file for app A, one for app B
              new HtmlWebpackPlugin({
                  filename: `app-a.html`,
                  template: resolve(__dirname, 'src', entry, `${entry}.html`),
                  scriptLoading: 'defer',
                  inject: 'body',
              }),
              new HtmlWebpackPlugin({
                  filename: `app-b.html`,
                  template: resolve(__dirname, 'src', entry, `${entry}.html`),
                  scriptLoading: 'defer',
                  inject: 'body',
              }),
          ];

    return {
        entry: {
            [isRoot ? 'root-app' : 'default-app']: resolve(__dirname, `./src/${entry}/${entry}.ts`),
        },
        output: {
            filename: '[name].[contenthash].js',
            path: resolve(__dirname, 'build'),
        },
        resolve: {
            extensions: ['.ts', '.tsx', '.js'],
            alias: {
                '@morgan-stanley/fdc3-web': resolve(__dirname, '../lib/dist'),
                '@morgan-stanley/fdc3-web-messaging-provider': resolve(__dirname, '../messaging-provider/dist'),
            },
            fullySpecified: false,
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: [
                        {
                            loader: 'ts-loader',
                            options: {
                                configFile: resolve(__dirname, './tsconfig.json'),
                            },
                        },
                    ],
                },
                {
                    test: /\.(scss|sass)$/,
                    use: ['style-loader', 'css-loader', 'sass-loader'],
                },
            ],
        },
        plugins,
        stats: {
            assets: true,
            colors: true,
            warnings: false,
            errors: true,
            errorDetails: true,
        },
        devtool: isDev ? 'source-map' : false,
        mode: isDev ? 'development' : 'production',
    };
};

module.exports = (env: Partial<Record<string, string | boolean>>, argv: Partial<Record<string, string>>) => {
    const serve = (env['WEBPACK_SERVE'] ?? false) === true;
    const isDev = argv.mode === 'development';

    const appConfigs = [buildConfig(true, isDev), buildConfig(false, isDev)];

    if (serve) {
        // we are running npm start-ui as a way to get quicker builds and auto browser refresh
        // when running npm start-ui alternate domains will NOT be available so cross domain testing will not work

        appConfigs[0].devServer = {
            allowedHosts: ['localhost'],
            open: ['root-app.html'],
            host: 'localhost',
            port: 4300,
            client: {
                overlay: {
                    errors: true,
                    warnings: false,
                    runtimeErrors: true,
                },
            },
        };
    }

    return appConfigs;
};
