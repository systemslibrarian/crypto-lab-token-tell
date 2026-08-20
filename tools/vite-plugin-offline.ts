/**
 * Emit a service worker that precaches exactly what this build produced.
 *
 * A hand-written sw.js cannot list Vite's output, because the filenames carry content
 * hashes that only exist after the bundle is written. So the list is injected here, and
 * the cache name is derived from it — which means adding or changing any asset
 * automatically invalidates the old cache instead of leaving a stale one behind.
 *
 * The list is read off the output directory rather than out of the bundle, and that is the
 * whole correctness of this file. `generateBundle` is handed the chunks Rollup produced,
 * and Vite copies `public/` AFTER it — so a list built there names the script, the
 * stylesheet and nothing else, while the icons, the web manifest and the social card are
 * all in `public/`. The one that had to be added back by hand was the web manifest, which
 * then declared three icons that were not cached at all: an installed app pointing at
 * three files it cannot fetch, showing a blank tile offline, which is the single piece of
 * visual identity this lab has. `closeBundle` runs after the copy, so a recursive read of
 * the directory at that point is the only list that is the truth. It also makes the cache
 * name honest, because the hash is then taken over a list the icons are actually in.
 *
 * The directory is the one Vite resolved, not the string 'dist': a build with any other
 * `build.outDir` was writing its service worker into a directory it had not built.
 *
 * Reading the directory does get one thing wrong, and it cost this lab its entire offline
 * story on every deploy since the worker was added: `public/.nojekyll` is copied into the
 * output like everything else, GitHub Pages refuses any path segment beginning with a
 * dot, and `Cache.addAll` rejects the whole batch on a single non-ok response. So one 404
 * on a zero-byte marker file nothing ever requests discarded the install, and the
 * registration with it — while `vite preview` answered the same URL with a 200, which is
 * precisely why the e2e suite and every local check went green over a worker that could
 * not install where it shipped. The dotfile filter below is that fix; `public/.nojekyll`
 * stays on disk because it still guards a branch-based deploy, it just never enters the
 * precache.
 *
 * Written rather than copied: no lab in this fleet ships a service worker, and the one
 * hand-written service worker in the wider repository set serves a site at a domain root
 * and uses root-absolute paths, which 404 under a GitHub Pages project subpath.
 */

import type { Plugin } from 'vite';

function shortHash(input: string): string {
  // FNV-1a. Not a security primitive — it only has to change when the asset list changes.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Every file under a directory, as paths relative to it and always with forward slashes,
 * because these become URLs rather than file paths the moment they leave here.
 */
async function filesUnder(directory: string, prefix = ''): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await filesUnder(join(directory, entry.name), name));
    else found.push(name);
  }
  return found;
}

export function offlinePlugin(base: string): Plugin {
  let outDir = 'dist';
  return {
    name: 'token-tell-offline',
    apply: 'build',
    async configResolved(config) {
      const { resolve } = await import('node:path');
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      sequential: true,
      async handler() {
        const { readFile, writeFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        // The worker cannot precache itself, and a source map is a debugging artefact no
        // reader offline is ever going to ask for. Dotfiles go for a harder reason: the
        // host does not serve them, `vite preview` does, and one 404 fails the whole
        // install — so anything the build writes under a dotted segment must be absent
        // from this list rather than merely unlikely to be asked for.
        const emitted = (await filesUnder(outDir))
          .filter((name) => name !== 'sw.js' && !name.endsWith('.map'))
          .filter((name) => !name.split('/').some((segment) => segment.startsWith('.')))
          .sort();
        // The shell is cached under the base path, which is the URL a navigation to the
        // lab actually asks for; `index.html` is the same bytes under a name nothing
        // requests, and caching both would store the document twice.
        const core = [...new Set(
          emitted.map((name) => (name === 'index.html' ? base : `${base}${name}`)))].sort();

        // Names AND bytes. Vite's own output carries a content hash in its filename, so a
        // changed script renames itself and a list of names notices — but everything that
        // came out of `public/` has a fixed name, and `npm run make:social` redraws the
        // icons and the social card in place. A name-only cache key would leave every
        // installed copy serving the old artwork for ever, which is the promise below
        // being false about exactly the files it was added to cover.
        let fingerprint = core.join('|');
        for (const name of emitted) {
          // latin1: one character per byte, which is what the FNV loop above reads.
          fingerprint += `|${name}:${shortHash(await readFile(join(outDir, name), 'latin1'))}`;
        }
        const version = `token-tell-${shortHash(fingerprint)}`;
        const source = `/* Generated by tools/vite-plugin-offline.ts at build time.
 * Precaches exactly the files this build wrote, under this deployment's base path.
 * The cache name is derived from their names and their bytes, so a changed asset —
 * including a redrawn icon that keeps its name — retires the old cache.
 *
 * Two clocks matter here and both are stated where they are used: the precache reads past
 * the HTTP cache's freshness window so a deploy is never half-installed, and a navigation
 * gives the network NAVIGATE_DEADLINE_MS to answer before the cached shell is served.
 */
'use strict';

const VERSION = ${JSON.stringify(version)};
const BASE = ${JSON.stringify(base)};
const CORE = ${JSON.stringify(core, null, 2)};

/* A navigation waits this long for the network before the cached shell is served.
 * A network that refuses a connection rejects at once and the catch would have been
 * enough; a captive portal or a hotel access point that accepts the connection and then
 * never answers rejects only after the browser's own timeout, tens of seconds, during
 * which the reader sits on a blank page with a complete copy of the lab in the cache
 * beside them. Three seconds is the trade: losing the race on a merely slow connection
 * costs one deploy of freshness, and the shell and its content-hashed assets come from
 * the same cache so the pair is always coherent — the next navigation picks up the new
 * deploy, and the worker installing in the background has already fetched it.
 */
const NAVIGATE_DEADLINE_MS = 3000;

/* cache: 'reload' rather than a plain URL, because addAll otherwise reads through the
 * HTTP cache. The host sends cache-control: max-age=600 on the document, so a return
 * visit inside that window would precache the PREVIOUS deploy's shell alongside THIS
 * deploy's script: a mismatched pair served with a 200, which is the one failure a
 * reader has no way to see. The cost is one revalidation per install, once.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(CORE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== VERSION).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network so a deploy is picked up, fall back to the cached shell
  // so the lab keeps working on a connection that is absent OR merely unresponsive. The
  // fetch is folded to null rather than left to reject, so a network that loses the race
  // cannot surface later as an unhandled rejection; and if nothing is cached yet the late
  // answer is still awaited, because a first visit has no shell to fall back to.
  if (request.mode === 'navigate') {
    const network = fetch(request).then((response) => response, () => null);
    const deadline = new Promise((resolve) => setTimeout(resolve, NAVIGATE_DEADLINE_MS));
    event.respondWith(
      Promise.race([network, deadline]).then((response) => response ?? caches.match(BASE)
        .then((cached) => cached ?? network.then((late) => late ?? Response.error()))),
    );
    return;
  }

  // Everything else is content-hashed, so a cache hit is always the right answer.
  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(VERSION).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
`;
        await writeFile(join(outDir, 'sw.js'), source, 'utf8');
      },
    },
  };
}
