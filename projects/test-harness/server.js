/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

const configFileName = process.env.APP_DIRECTORY_CONFIG_FILE_PATH ?? './src/test-harness.config.json';

const path = require('path');
const express = require('express');
const cors = require('cors');

//can swap in different config files
const config = require(configFileName);

const basePort = 4300;

/**
 * Creates and starts an Express server to serve apps of test harness.
 * @param {string} folder - The path to the folder containing static files to serve.
 * @param {number} port - The port number on which the server will listen.
 */
function createServer(domain, folder, port) {
    const app = express();
    const folderPath = path.resolve(__dirname, folder);
    //allows all origins to access server resources
    //TODO: add mapping from root domain to default apps folder to server default app from root domain as well as from secondary domains
    app.use(cors(), express.static(folderPath));
    app.listen(port, () =>
        console.log(`${domain} Server serving '${folderPath}' running at http://localhost:${port}`),
    ).on('error', err => console.error(`Failed to start ${domain} Server on port ${port}:`, err));
    return app;
}

if (configFileName === './src/test-harness.config.json') {
    const domains = Array.from(
        new Set([
            'root',
            ...config.applications
                .map(app => app.appId.substring(app.appId.indexOf('-', 4) + 1))
                .filter(domain => domain),
        ]),
    );

    // Create servers for each domain
    let currentPort = basePort;
    domains.forEach(domain => createServer(domain, `build`, currentPort++));
}

console.log(`\n\nFDC3 Test Harness url: http://localhost:${basePort}/root-app.html\n`);

// Setup mock app-directory server

const appDirectoryPort = 4299;
const app = createServer('app-directory', `dist/app-directory`, appDirectoryPort);
console.log(`\n\nMock App Directory Service base url: http://localhost:${appDirectoryPort}`);

// Routing for app-directory service

const rootApp = {
    appId: 'test-harness-root-app',
    title: 'Root App',
    type: 'web',
    details: {
        url: `http://localhost:${basePort}/root-app.html`,
    },
};

app.get('/(v2/)?apps', (_, res) => {
    const allApplicationsResponse = {
        applications: [rootApp, ...config.applications],
        message: 'OK',
    };
    res.send(allApplicationsResponse);
});

[rootApp, ...config.applications].forEach(application => {
    app.get(`/(v2/)?apps/${application.appId}`, (_, res) => {
        res.send(application);
    });
});
