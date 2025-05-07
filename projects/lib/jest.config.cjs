const path = require('path');
const baseConfig = require('../../jest.config');

module.exports = {
    ...baseConfig,
    collectCoverageFrom: ['./src/**/*.ts', '!./src/**/index.ts'],
    setupFilesAfterEnv: ['../test.ts'],
    coverageDirectory: path.join('../../build', 'coverage-results', 'lib'),
    reporters: [
        'default',
        [
            'jest-junit',
            {
                outputDirectory: path.join('../../build', 'test-results', 'lib'),
                outputName: 'TESTS.xml',
            },
        ],
        [
            'jest-html-reporters',
            {
                publicPath: path.join('../../build', 'coverage-results', 'lib'),
                pageTitle: 'Testing report',
                inlineSource: true,
            },
        ],
    ],
};
