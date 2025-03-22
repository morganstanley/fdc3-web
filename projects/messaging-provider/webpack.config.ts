const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlInlineScriptWebpackPlugin = require('html-inline-script-webpack-plugin');

import 'webpack-dev-server';
import { resolve } from 'path';

module.exports = {
    mode: 'production',
    context: __dirname,
    entry: resolve(__dirname, 'src/relay/index.ts'),
    resolve: {
        extensions: ['.ts', '.js'],
    },
    output: {
        filename: 'bundle.js',
        path: resolve(__dirname, 'dist/fdc3-iframe-relay'),
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: resolve(__dirname, 'tsconfig.json'),
                        compilerOptions: {
                            emitDeclarationOnly: false,
                        },
                    },
                },
                exclude: /node_modules/,
            },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({
            inlineSource: '.(js)$',
        }),
        new HtmlInlineScriptWebpackPlugin(),
        new CopyPlugin({
            patterns: [
                { from: 'package.json', to: resolve(__dirname, 'dist') },
                { from: 'README.md', to: resolve(__dirname, 'dist') },
            ],
        }),
    ],
};
