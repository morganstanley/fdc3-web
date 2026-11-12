/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import './site.css';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import typescript from 'highlight.js/lib/languages/typescript';
import { Marked } from 'marked';
import apiRegistry from './api/registry.json';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('typescript', typescript);

const REPOSITORY = 'https://github.com/morganstanley/fdc3-web';
const escapeHtml = (text: string): string =>
    text.replace(
        /[&<>"']/g,
        character =>
            ({
                '&': '\x26amp;',
                '<': '\x26lt;',
                '>': '\x26gt;',
                '"': '\x26quot;',
                "'": '\x26#39;',
            })[character]!,
    );
const slugify = (text: string): string =>
    text
        .toLowerCase()
        .replace(/[^\w\- ]/g, '')
        .trim()
        .replace(/ /g, '-');
/** Per-page heading ids. Repeated titles such as Parameters/Returns become parameters-2, parameters-3, ... */
const headingCounts = new Map<string, number>();
const uniqueSlug = (text: string): string => {
    const base = slugify(text);
    const count = headingCounts.get(base) ?? 0;
    headingCounts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
};
const highlight = (code: string, language?: string): string =>
    language && hljs.getLanguage(language) ? hljs.highlight(code, { language }).value : escapeHtml(code);

interface Doc {
    title: string;
    markdown: string;
    path: string;
}
interface ApiEntry {
    name: string;
    route: string;
    kind: string;
    anchor: string;
}

let currentDocument: Doc | undefined;
const rawDocs = import.meta.glob('../../docs/**/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;
const rawApi = import.meta.glob('./api/**/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;
const documents = new Map<string, Doc>();
const apiDocuments = new Map<string, Doc>();

function recordDocuments(raw: Record<string, string>, api: boolean): void {
    for (const [filename, markdown] of Object.entries(raw)) {
        const relative = api ? filename.replace('./api/', '') : filename.replace('../../docs/', '');
        const route = relative.replace(/\.md$/, '');
        const title = /(?:^|\n)#\s+(.+)/.exec(markdown)?.[1].trim() ?? (api ? 'API reference' : 'Documentation');
        const doc = { title, markdown, path: relative };
        if (api) apiDocuments.set(route, doc);
        else documents.set(route, doc);
    }
}
recordDocuments(rawDocs, false);
recordDocuments(rawApi, true);

const navigation = [
    { title: 'Start here', links: [['Getting started', 'getting-started']] },
    {
        title: 'Core concepts',
        links: [
            ['Desktop Agents', 'guides/desktop-agent'],
            ['Channels', 'guides/channels'],
            ['Intents', 'guides/intents'],
            ['Private channels', 'guides/private-channels'],
            ['App Directory', 'guides/app-directory'],
        ],
    },
    {
        title: 'Learn by example',
        links: [
            ['The test harness', 'examples/host'],
            ['Opening apps', 'examples/applications'],
            ['Private channels', 'examples/private-channels'],
        ],
    },
    {
        title: 'Reference',
        links: [
            ['API overview', 'api/modules'],
            ['Contributing', 'contributing'],
        ],
    },
];

const apiEntries = apiRegistry as ApiEntry[];
const apiCollectionKind: Record<string, string> = {
    classes: 'class',
    interfaces: 'interface',
    functions: 'function',
    'type-aliases': 'type',
    enums: 'enum',
    variables: 'const',
};
const findApiEntry = (kind: string, name: string): ApiEntry | undefined =>
    apiEntries.find(entry => entry.kind === kind && entry.name === name);

const marked = new Marked({
    renderer: {
        code({ text, lang }) {
            return `<pre><button class="copy" type="button">Copy code</button><code class="hljs">${highlight(text, lang)}</code></pre>`;
        },
        heading({ tokens, depth, text }) {
            const id = uniqueSlug(text);
            const heading = this.parser.parseInline(tokens);
            if (depth === 1) return `<h1 id="${id}">${heading}</h1>`;
            return `<h${depth} id="${id}">${heading}<a class="anchor" href="#" data-anchor="${id}" aria-label="Link to ${escapeHtml(text)}">#</a></h${depth}>`;
        },
        link({ href, tokens }) {
            let label = this.parser.parseInline(tokens);
            let target = href;
            if (!/^https?:|mailto:|^\//.test(href)) {
                if (href.startsWith('#')) {
                    target = href;
                } else {
                    const match = /^(.*?)(?:#(.*))?$/.exec(href)!;
                    const rawPath = match[1].replace(/\.md$/, '');
                    const sourceCode = /^(.*?\.ts):?(\d+)?$/.exec(rawPath);
                    if (currentDocument && apiDocuments.has(currentDocument.path.replace(/\.md$/, '')) && sourceCode) {
                        target = `${REPOSITORY}/blob/main/projects/fdc3-web/src/${sourceCode[1]}${sourceCode[2] ? `#L${sourceCode[2]}` : ''}`;
                    } else if (rawPath.startsWith('http')) {
                        target = `${href}`;
                    } else {
                        const directory = currentDocument?.path.split('/').slice(0, -1) ?? [];
                        const segments = [...directory, ...rawPath.split('/')];
                        const resolved: string[] = [];
                        for (const segment of segments) {
                            if (segment === '..') resolved.pop();
                            else if (segment && segment !== '.') resolved.push(segment);
                        }
                        const route = resolved.join('/');
                        target = `#/${route}${match[2] ? `#${match[2]}` : ''}`;
                    }
                }
                label = label.replace(/`([^`]+)`/g, '$1');
            }
            const external = /^https?:/.test(target) ? ' target="_blank" rel="noopener"' : '';
            return `<a href="${escapeHtml(target)}"${external}>${label}</a>`;
        },
        html({ raw }) {
            const text = raw;
            const explicitId = /^<a id="([^"]+)"><\/a>\s*$/i.exec(text.trim());
            if (explicitId) return explicitId[0];
            // Only authored Markdown and TypeDoc text enter here. Escape raw HTML from doc comments.
            return escapeHtml(text);
        },
    },
});
const parseDocument = (markdown: string): string => {
    headingCounts.clear();
    return marked.parse(markdown) as string;
};

const page = document.querySelector<HTMLElement>('#page')!;
const sidebar = document.querySelector<HTMLElement>('#side')!;
const menu = document.querySelector<HTMLButtonElement>('#menu')!;
const scrim = document.querySelector<HTMLElement>('#scrim')!;

function navigationHtml(active: string): string {
    return navigation
        .map(group => {
            const links = group.links
                .map(
                    ([label, route]) =>
                        `<a href="#/${route}"${active === route ? ' aria-current="page"' : ''}>${label}</a>`,
                )
                .join('');
            return `<h2>${group.title}</h2>${links}`;
        })
        .join('');
}

function closeMenu(): void {
    sidebar.classList.remove('open');
    scrim.classList.remove('open');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Open documentation menu');
}

function renderMarkdown(doc: Doc, api: boolean): void {
    currentDocument = doc;
    page.innerHTML = `${api ? '<div class="breadcrumbs"><a href="#/api/modules">API reference</a> / generated from TypeScript</div>' : ''}<article>${parseDocument(doc.markdown)}</article>`;
    document.title = `${doc.title.replace(/`/g, '')} · fdc3-web`;
}

function apiOverview(doc: Doc): void {
    currentDocument = doc;
    page.innerHTML = `<article>${parseDocument(doc.markdown)}</article>
        <p class="api-intro">Regenerated with TypeDoc on every site build from <code>projects/fdc3-web/src/index.ts</code>. Function parameters and return types follow the library's actual public contracts. Standard FDC3 DesktopAgent types are defined by <code>@finos/fdc3</code>.</p>
        <label for="api-search"><strong>Browse the generated reference</strong></label>
        <input id="api-search" class="api-search" type="search" placeholder="Filter by e.g. getAgent, channel or strategy" aria-label="Filter API symbols" />
        <div id="api-list" class="api-list" aria-live="polite"></div>
        <a class="api-source-link" href="${REPOSITORY}/blob/main/projects/fdc3-web/src/index.ts" target="_blank" rel="noopener">View the public exports on GitHub ↗</a>`;
    const list = page.querySelector<HTMLElement>('#api-list')!;
    const draw = (query: string): void => {
        const filter = query.trim().toLowerCase();
        const shown = apiEntries.filter(entry => `${entry.name} ${entry.kind}`.toLowerCase().includes(filter));
        list.innerHTML = shown.length
            ? shown
                  .map(
                      entry =>
                          `<a class="api-entry" href="#/api/${entry.route}#${entry.anchor}"><span><span class="api-kind">${escapeHtml(entry.kind)}</span>${escapeHtml(entry.name)}</span><span class="api-summary">View generated docs →</span></a>`,
                  )
                  .join('')
            : '<p class="api-empty">No public exports match that filter. Try a shorter name.</p>';
    };
    page.querySelector<HTMLInputElement>('#api-search')!.addEventListener('input', event =>
        draw((event.target as HTMLInputElement).value),
    );
    draw(' ');
}

function home(): void {
    currentDocument = undefined;
    const cards = [
        [
            'Meet the Desktop Agent',
            'Connect web apps across frames, windows and origins using the standard FDC3 interface.',
            'guides/desktop-agent',
        ],
        [
            'Share the right context',
            'Use user, app and private channels to coordinate applications and their workflows.',
            'guides/channels',
        ],
        [
            'Make intents actionable',
            'Raise an action, discover a capable app and return results without hard-coded integrations.',
            'guides/intents',
        ],
        [
            'Discover and launch apps',
            'Combine remote and local App Directories with your own window-management strategies.',
            'guides/app-directory',
        ],
    ];
    page.innerHTML = `<section class="hero"><div class="hero-content"><p class="eyebrow">Open source · FINOS FDC3</p>
      <h1>Interoperability,<br /><strong>built for the web.</strong></h1>
      <p class="lead">Connect browser-based financial applications with the familiar FDC3 Desktop Agent API. Across frames, windows and origins.</p>
      <div class="hero-actions"><a class="button button-primary" href="#/getting-started">Get started →</a><a class="button button-subtle" href="#/examples/host">Explore the test harness</a></div>
      <div class="install"><code>npm install @morgan-stanley/fdc3-web</code><button type="button" data-copy="npm install @morgan-stanley/fdc3-web @finos/fdc3">Copy install command</button></div>
    </div></section>
    <p class="intro">A browser-native implementation of the FDC3 standard from Morgan Stanley. Build connected application experiences without coupling your apps to a particular host.</p>
    <div class="cards">${cards.map(([title, description, route]) => `<a class="card" href="#/${route}"><h2>${title}</h2><p>${description}</p><span class="arrow">READ THE GUIDE →</span></a>`).join('')}</div>
    <div class="quickstart"><h2>A first connection, not a new framework.</h2><p>As the test harness does, discover the parent Desktop Agent from your app.</p></div>
    <pre><button class="copy" type="button">Copy code</button><code class="hljs">${highlight("import { getAgent } from '@morgan-stanley/fdc3-web';\\n\\nconst agent = await getAgent();\\nconst { appMetadata } = await agent.getInfo();", 'ts')}</code></pre>
    <div class="home-links"><a href="#/api/modules">Generated API reference ↗</a><a href="#/contributing">Contributing to fdc3-web ↗</a><a href="https://fdc3.finos.org/" target="_blank" rel="noopener">The FDC3 standard ↗</a></div>`;
    document.title = 'fdc3-web · Interoperability for web apps';
}

function route(): void {
    const hash = location.hash.replace(/^#\/?/, '');
    const [routeName, originalAnchor] = hash.split('#');
    let anchor = originalAnchor;
    if (routeName !== 'api/modules') window.scrollTo(0, 0);
    closeMenu();
    if (!routeName) home();
    else if (routeName === 'api/modules') apiOverview(apiDocuments.get('modules')!);
    else if (routeName.startsWith('api/')) {
        const alias = /^api\/(classes|interfaces|functions|type-aliases|enums|variables)\/([^/#]+)$/.exec(routeName);
        const entry = alias ? findApiEntry(apiCollectionKind[alias[1]], alias[2]) : undefined;
        if (entry && !anchor) anchor = entry.anchor;
        const doc = apiDocuments.get(entry?.route ?? routeName.slice(4));
        if (doc) renderMarkdown(doc, true);
        else
            page.innerHTML =
                '<h1>API page not found</h1><p>Start with the <a href="#/api/modules">API overview</a> and browse the current public exports.</p>';
    } else {
        const doc = documents.get(routeName);
        if (doc) renderMarkdown(doc, false);
        else
            page.innerHTML =
                '<h1>Page not found</h1><p>Try the <a href="#/getting-started">getting-started guide</a> instead.</p>';
    }
    const section = routeName.startsWith('guides/')
        ? '#/guides/'
        : routeName.startsWith('examples/')
          ? '#/examples/'
          : routeName.startsWith('api/')
            ? '#/api/'
            : '#/getting-started';
    document
        .querySelectorAll<HTMLAnchorElement>('.topnav a')
        .forEach(link => link.classList.toggle('on', section.startsWith(link.hash)));
    sidebar.innerHTML = navigationHtml(
        routeName === 'contributing'
            ? 'contributing'
            : routeName === 'getting-started'
              ? 'getting-started'
              : routeName.startsWith('guides/')
                ? routeName
                : routeName.startsWith('examples/')
                  ? routeName
                  : 'api/modules',
    );
    requestAnimationFrame(() =>
        anchor ? document.getElementById(anchor)?.scrollIntoView({ behavior: 'instant' }) : window.scrollTo(0, 0),
    );
}

page.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('button.copy, button[data-copy]');
    if (button) {
        const text = button.dataset.copy ?? button.parentElement?.querySelector('code')?.textContent;
        if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
        button.textContent = 'Copied';
        setTimeout(() => (button.textContent = button.dataset.copy ? 'Copy install command' : 'Copy code'), 1400);
    }
    const anchor = target.closest<HTMLAnchorElement>('a.anchor');
    if (anchor) {
        event.preventDefault();
        const section = anchor.dataset.anchor!;
        history.replaceState(null, '', `${location.hash.split('#').slice(0, 2).join('#')}#${section}`);
        document.getElementById(section)?.scrollIntoView();
    }
});

sidebar.addEventListener('click', (event): void => {
    if ((event.target as HTMLElement).closest('a')) closeMenu();
});
menu.addEventListener('click', () => {
    // toggle() reports the class after the click, so this is true when the menu is now closed.
    const isClosed = !sidebar.classList.toggle('open');
    scrim.classList.toggle('open', !isClosed);
    menu.setAttribute('aria-expanded', String(!isClosed));
    menu.setAttribute('aria-label', isClosed ? 'Open documentation menu' : 'Close documentation menu');
});
scrim.addEventListener('click', closeMenu);
window.addEventListener('hashchange', route);
window.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
});
route();
