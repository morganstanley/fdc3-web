import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = path.resolve(site, '..');
const docs = path.join(repository, 'docs');
const generatedApi = path.join(site, 'src/api');
const errors = [];

/** Recursively gather a required file type. */
// Next line is JavaScript; the inherited TypeScript return-type rule does not apply.
async function filesUnder(directory, extension) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map(async entry => {
            const filename = path.join(directory, entry.name);
            return entry.isDirectory() ? filesUnder(filename, extension) : [filename];
        }),
    );
    return nested.flat().filter(file => file.endsWith(extension));
}
const sourceFiles = await filesUnder(docs, '.md');
let apiFiles = [];
try {
    apiFiles = await filesUnder(generatedApi, '.md');
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
}
const routeByFile = new Map();
for (const file of [...sourceFiles, ...apiFiles]) {
    const [markdown, fileInfo] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
    const fromDocs = !file.startsWith(generatedApi + path.sep);
    const relative = path.relative(fromDocs ? docs : site, file).replaceAll(path.sep, '/');
    const route = fromDocs
        ? relative.replace(/\.md$/, '')
        : `api/${path.relative(generatedApi, file).replace(/\.md$/, '').replaceAll(path.sep, '/')}`;
    const headings = [...markdown.matchAll(/<a id="([^"]+)"><\/a>/g)]
        .map(match => match[1])
        .concat(
            (markdown.match(/^#{1,6} (.+)$/gm) ?? []).map(heading =>
                heading
                    .replace(/^#{1,6} /, '')
                    .trim()
                    .toLowerCase()
                    .replace(/[^\w\- ]/g, '')
                    .replace(/ /g, '-'),
            ),
        );
    routeByFile.set(file, { route, headings, bytes: fileInfo.size });
}
for (const file of [...routeByFile.keys()]) {
    const markdown = await readFile(file, 'utf8');
    for (const match of markdown.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
        const href = match[1].split(/\s+['"]/)[0];
        if (/^(?:https?:|mailto:|#(?!\/))/.test(href)) continue;
        const [rawPath, anchor] = decodeURI(href).split('#');
        let targetFile;
        let route;
        if (rawPath.startsWith('#/')) continue;
        if (file.startsWith(generatedApi + path.sep) && /\.ts(?::\d+)?$/.test(rawPath)) continue;
        if (file.startsWith(generatedApi + path.sep)) {
            targetFile = path.resolve(path.dirname(file), rawPath);
            route = routeByFile.get(targetFile)?.route;
            if (!route) {
                errors.push(`${path.relative(repository, file)}: unresolved TypeDoc link ${href}`);
                continue;
            }
        } else if (rawPath.startsWith('../api/') || rawPath.startsWith('api/')) {
            route = rawPath.replace(/^\.\.\//, '').replace(/\.md$/, '');
            targetFile = path.join(site, 'src', `${route}.md`);
        } else {
            targetFile = path.resolve(path.dirname(file), rawPath);
            route = routeByFile.get(targetFile)?.route;
        }
        const destination = routeByFile.get(targetFile);
        if (!route) {
            errors.push(`${path.relative(repository, file)}: unresolved ${href}`);
        } else if (anchor && destination && !destination.headings.includes(anchor)) {
            errors.push(`${path.relative(repository, file)}: missing heading ${href}`);
        }
    }
}

const registry = JSON.parse(await readFile(path.join(generatedApi, 'registry.json'), 'utf8'));
const routesAndHeadings = new Map([...routeByFile.values()].map(entry => [entry.route, entry.headings]));
for (const entry of registry) {
    const route = `api/${entry.route}`;
    if (!routesAndHeadings.get(route)?.includes(entry.anchor)) {
        errors.push(`Generated registry:${entry.kind} ${entry.name} does not resolve to ${route}#${entry.anchor}`);
    }
}
if (registry.length !== 176) console.log(`Generated API registry contains ${registry.length} public exports`);

for (const [file, { bytes }] of routeByFile) {
    if (bytes === 0) errors.push(`${path.relative(repository, file)} is empty`);
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(
    `Checked ${sourceFiles.length} source guides and ${apiFiles.length} generated API pages, including relative links.`,
);
