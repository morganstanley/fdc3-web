import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Application, EntryPointStrategy, TSConfigReader, TypeDocReader } from 'typedoc';
import ts from 'typescript';

const directory = dirname(fileURLToPath(import.meta.url));
const site = resolve(directory, '..');
const repository = resolve(site, '..');
const output = resolve(site, 'src/api');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const application = await Application.bootstrapWithPlugins(
    {
        entryPoints: [resolve(repository, 'projects/fdc3-web/src')],
        entryPointStrategy: EntryPointStrategy.Expand,
        tsconfig: resolve(repository, 'projects/fdc3-web/tsconfig.lib.json'),
        out: resolve(repository, 'tmp/typedoc'),
        theme: 'markdown',
        plugin: ['typedoc-plugin-markdown'],
        excludePrivate: true,
        excludeProtected: true,
        excludeExternals: true,
        exclude: ['**/*.spec.ts', '**/constants.ts'],
        excludeNotDocumented: false,
        includeVersion: true,
        readme: 'none',
        gitRemote: 'upstream',
        gitRevision: 'main',
        hidePageHeader: true,
        hideBreadcrumbs: true,
        hideGroupHeadings: false,
        useCodeBlocks: true,
        expandObjects: true,
        parametersFormat: 'table',
        propertiesFormat: 'table',
        interfacePropertiesFormat: 'table',
        classPropertiesFormat: 'table',
        enumMembersFormat: 'table',
        typeDeclarationFormat: 'table',
        typeAliasPropertiesFormat: 'table',
        outputFileStrategy: 'modules',
        mergeReadme: false,
        flattenOutputFiles: false,
        modulesFileName: 'modules.md',
    },
    [new TypeDocReader(), new TSConfigReader()],
);
const project = await application.convert();
if (!project) throw new Error('TypeDoc could not convert the public library source');
await application.outputs.writeOutput({ name: 'markdown', path: output }, project);
await application.outputs.writeOutput({ name: 'json', path: resolve(output, 'api.json') }, project);
if (application.logger.errorCount > 0) throw new Error('TypeDoc reported configuration or conversion errors');
await rm(resolve(output, 'README.md'), { force: true });
/** Convert generated source links to stable upstream URLs. */
// FINOS's own DesktopAgent type is external; keep the inherited listener link clickable.
for (const path of ['channel/channel.private', 'channel/channel.public']) {
    const file = resolve(output, `${path}.md`);
    const markdown = await readFile(file, 'utf8');
    await writeFile(
        file,
        markdown.replaceAll(
            '(DesktopAgent#addcontextlistener)',
            '(https://fdc3.finos.org/docs/api/ref/DesktopAgent#addcontextlistener)',
        ),
    );
}
// Index only symbols re-exported by the package, not implementation-only modules
// traversed by TypeDoc while rendering those exports.
const apiRoot = resolve(repository, 'projects/fdc3-web/src/index.ts');
const config = ts.readConfigFile(resolve(repository, 'projects/fdc3-web/tsconfig.lib.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(repository, 'projects/fdc3-web'));
const program = ts.createProgram([apiRoot], parsed.options);
const checker = program.getTypeChecker();
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) throw new Error('TypeScript could not inspect the public exports');
const source = program.getSourceFile(apiRoot);
const registry = [];

/** Follow `export { name } from` to the declaration that introduces the symbol. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- .mjs cannot declare a return type
const exportedDeclaration = symbol => {
    let current = symbol;
    const seen = new Set();
    while (current.flags & ts.SymbolFlags.Alias) {
        if (seen.has(current)) break;
        seen.add(current);
        const next = checker.getAliasedSymbol(current);
        if (!next || next === current) break;
        current = next;
    }
    return current.declarations?.[0];
};

/**
 * Classify from the real declaration. A `ts.is*` ladder that treats every
 * variable as a function (and everything else as a type) mislabels `const`
 * exports and enums.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- .mjs cannot declare a return type
const exportKind = declaration => {
    if (ts.isClassDeclaration(declaration)) return 'class';
    if (ts.isInterfaceDeclaration(declaration)) return 'interface';
    if (ts.isEnumDeclaration(declaration)) return 'enum';
    if (ts.isFunctionDeclaration(declaration)) return 'function';
    if (ts.isVariableDeclaration(declaration)) {
        return ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const ? 'const' : 'variable';
    }
    if (ts.isTypeAliasDeclaration(declaration)) return 'type';
    return 'type';
};

for (const symbol of checker.getExportsOfModule(checker.getSymbolAtLocation(source))) {
    // Re-exports such as getAgent are ExportSpecifiers. Resolving the alias
    // yields the original const in get-agent.ts, so the route and kind are set once.
    const declaration = exportedDeclaration(symbol);
    const declarationFile = declaration?.getSourceFile().fileName;
    if (!declarationFile || declarationFile.includes('/contracts.internal.ts')) continue;
    const relative = path.relative(resolve(repository, 'projects/fdc3-web/src'), path.resolve(declarationFile));
    const route = relative.replace(/\.ts$/, '').replace(/\/index$/, '');
    const kind = exportKind(declaration);
    const anchor = symbol.name.toLowerCase();
    registry.push({ name: symbol.name, kind, route, anchor });
    // Shared module pages document these as `### Name` rather than as the page heading.
    if (kind === 'type' || kind === 'interface' || kind === 'enum' || kind === 'const') {
        const filename = resolve(output, `${route}.md`);
        const markdown = await readFile(filename, 'utf8');
        const target = `### ${symbol.name}\n`;
        if (markdown.includes(target) && !markdown.includes(`<a id="${anchor}"></a>`)) {
            await writeFile(filename, markdown.replace(target, `<a id="${anchor}"></a>\n\n${target}`));
        }
    }
}
await writeFile(
    resolve(output, 'registry.json'),
    JSON.stringify(
        registry.sort((a, b) => a.name.localeCompare(b.name)),
        null,
        4,
    ) + '\n',
);
await cp(resolve(output, 'index.md'), resolve(output, 'modules.md'));
for (const file of ['LICENSE', 'NOTICE']) await cp(resolve(repository, file), resolve(site, 'public', file));
console.log(`Generated Markdown reference and indexed ${registry.length} public exports`);
