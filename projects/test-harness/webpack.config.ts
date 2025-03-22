const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

import 'webpack-dev-server';
import { resolve } from 'path';
import { Configuration } from 'webpack';
import { applications } from './src/test-harness.config.json';

const buildConfig = (id: string, entry: string, output: string, isDev: boolean): Configuration => {
    return {
        entry: {
            [id]: resolve(__dirname, `./src/${entry}/${entry}.ts`),
        },
        output: {
            filename: '[name].[contenthash].js',
            path: resolve(__dirname, 'dist', output),
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
        plugins: [
            new HtmlWebpackPlugin({
                filename: `${id}.html`,
                template: resolve(__dirname, 'src', entry, `${entry}.html`),
                chunks: [id],
                scriptLoading: 'defer',
                inject: 'body',
            }),
            output === 'root' &&
                new CopyPlugin({
                    patterns: [
                        { from: resolve(__dirname, 'src', 'assets'), to: 'assets' },
                        {
                            from: resolve(__dirname, '../messaging-provider/dist/fdc3-iframe-relay'),
                            to: 'fdc3-iframe-relay',
                        },
                    ],
                }),
        ],
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

    const appConfigs = [{ appId: 'root-app' }, ...applications]
        .filter(app => !serve || app.appId.includes('root'))
        .map(app =>
            app.appId === 'root-app'
                ? buildConfig(app.appId, 'root-app', 'root', isDev)
                : buildConfig(
                      app.appId,
                      app.appId === 'test-lit-app' ? 'test-lit-app' : 'default-app',
                      app.appId.substring(app.appId.indexOf('-', 4) + 1),
                      isDev,
                  ),
        );
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
