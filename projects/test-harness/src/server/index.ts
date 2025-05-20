/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

const configFileName = process.env.APP_DIRECTORY_CONFIG_FILE_PATH ?? './assets/test-harness.config.json';

import cors from 'cors';
import express from 'express';
import { Express } from 'express-serve-static-core';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

//can swap in different config files
const { default: config } = await import(configFileName, { with: { type: 'json' } });

const rootPort = 4200;
const basePort = 4300;

/**
 * Creates and starts an Express server to serve apps of test harness.
 * @param {string} folder - The path to the folder containing static files to serve.
 * @param {number} port - The port number on which the server will listen.
 */
function createServer(domain: string, port: number, serveStatic: boolean = false): Express {
    const app: Express = express();
    let folderPath: string | undefined = undefined;

    //allows all origins to access server resources
    app.use(cors());

    if (serveStatic) {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);

        folderPath = resolve(__dirname, '../ui');
        app.use(express.static(folderPath));
    }

    app.listen(port, () => {
        const servingFolder = folderPath ? `serving '${folderPath}' ` : '';
        console.log(`${domain} Server ${servingFolder}running at http://localhost:${port}`);
    }).on('error', err => console.error(`Failed to start ${domain} Server on port ${port}:`, err));
    return app;
}

if (configFileName.includes('test-harness.config.json')) {
    console.log(`Starting servers for test harness applications...`);

    const domains = Array.from(
        new Set([
            ...config.applications
                .filter((application: any) => application.details.url.includes('localhost'))
                .map((app: any) => app.appId.substring(app.appId.indexOf('-', 4) + 1))
                .filter((domain: string) => domain !== 'root'),
        ]),
    );

    // Create servers for each domain
    let currentPort = basePort;
    domains.forEach(domain => createServer(domain, currentPort++, true));
}

console.log(`\n\nFDC3 Test Harness url: http://localhost:${rootPort}/index.html\n`);

// Setup mock app-directory server

const appDirectoryPort = 4299;
const app = createServer('app-directory', appDirectoryPort);
console.log(`\n\nMock App Directory Service base url: http://localhost:${appDirectoryPort}`);

// Routing for app-directory service

const rootApp = {
    appId: 'test-harness-root-app',
    title: 'Root App',
    type: 'web',
    details: {
        url: `http://localhost:${rootPort}/index.html`,
    },
};

app.get('/v2/apps', (_, res) => {
    const allApplicationsResponse = {
        applications: [rootApp, ...config.applications],
        message: 'OK',
    };
    res.send(allApplicationsResponse);
});

[rootApp, ...config.applications].forEach(application => {
    app.get(`/v2/apps/${application.appId}`, (_, res) => {
        res.send(application);
    });
});
