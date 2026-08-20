import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * The offline shell, checked under the host's rules rather than the preview server's.
 *
 * This file exists because the suite already here could not have caught the defect it is
 * written to prevent, and it is worth being precise about why. `smoke.spec.ts` asserts
 * that every icon the page declares is precached, and it passed, green, over a service
 * worker that had never once installed on the host this lab actually ships to. The build
 * copies `public/.nojekyll` into the output; the precache list is read off that directory;
 * `Cache.addAll` rejects the entire batch on a single non-ok response — and `vite preview`
 * answers `/crypto-lab-token-tell/.nojekyll` with a 200 while GitHub Pages answers the
 * identical path, from the identical bytes, with a 404. The whole defect lived in the
 * difference between the local server and the host, so no test served by the local server
 * could ever see it, however much it asserted.
 *
 * The answer is to stop trusting the server twice over. The first test reads the list the
 * build generated and asserts a property of the URLs themselves — no server is involved,
 * so no server difference can hide it. The second serves the same build through a stand-in
 * that applies the rule the host applies, and drives a real install and a real offline
 * navigation through it, so the sentence in README.md about the site working offline after
 * the first visit is measured rather than asserted.
 *
 * Neither test replaces the other. A property check cannot tell you the install succeeded;
 * an install against one stand-in cannot tell you the next host rule this build trips over.
 */

const DIST = resolve(import.meta.dirname, '..', 'dist');
const BASE = '/crypto-lab-token-tell/';

/**
 * The precache list read back out of the artefact that ships, rather than recomputed here.
 * A check that rebuilt the list from the same rules as the plugin would agree with the
 * plugin by construction and prove nothing.
 */
async function precacheList(): Promise<string[]> {
  const source = await readFile(join(DIST, 'sw.js'), 'utf8');
  const declaration = /^const CORE = (\[[\s\S]*?^\]);$/m.exec(source);
  expect(declaration, 'dist/sw.js must declare a CORE list').not.toBeNull();
  return JSON.parse(declaration![1]) as string[];
}

test('every precached URL is one the host will actually serve', async () => {
  const core = await precacheList();

  // Asserted before anything else, because an empty list satisfies every property below
  // while precaching nothing — and a cache holding zero entries is exactly what the live
  // origin had. Nine files: the shell, the script, the stylesheet, four icons, the web
  // manifest and the social card.
  expect(core.length, 'the precache must name the whole shell').toBeGreaterThanOrEqual(9);

  // The rule this file exists for. GitHub Pages refuses any path whose segment begins
  // with a dot; `vite preview` serves them; and one non-ok response fails the whole
  // install, so a single such entry is not a missing file but a missing service worker.
  const dotted = core.filter((url) => url.split('/').some((part) => part.startsWith('.')));
  expect(dotted, `precached but unreachable on the host: ${dotted.join(', ')}`).toEqual([]);

  // Under the deployment's base path, for the same class of reason: a root-absolute URL
  // that escapes the subpath 404s on a project Pages site and takes the install with it.
  const escaping = core.filter((url) => !url.startsWith(BASE));
  expect(escaping, `precached outside ${BASE}: ${escaping.join(', ')}`).toEqual([]);
});

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

/**
 * A stand-in for the host: this build, under the base path, with the two behaviours that
 * distinguish GitHub Pages from `vite preview` and that between them account for the
 * defect — a dotted path segment is refused, and the document carries the same
 * `cache-control: max-age=600` that makes a return visit read the precache through the
 * HTTP cache unless the worker asks it not to.
 *
 * Deliberately not a fixture shared with the rest of the suite: this server is the thing
 * under test as much as the worker is, and it should be readable in one screen alongside
 * the assertions that depend on it.
 */
async function startHostStandIn(): Promise<{
  origin: string; refused: string[]; close: () => Promise<void>;
}> {
  const refused: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const miss = (): void => {
      refused.push(path);
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end('<h1>404</h1>');
    };
    if (!path.startsWith(BASE)) return miss();
    const relative = path.slice(BASE.length) || 'index.html';
    if (relative.split('/').some((part) => part.startsWith('.'))) return miss();
    void (async () => {
      let body: Buffer;
      try {
        if (!(await stat(join(DIST, relative))).isFile()) throw new Error('not a file');
        body = await readFile(join(DIST, relative));
      } catch {
        return miss();
      }
      response.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(relative)] ?? 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'max-age=600',
      }).end(body);
    })();
  });
  await new Promise<void>((listening) => { server.listen(0, '127.0.0.1', listening); });
  const { port } = server.address() as AddressInfo;
  return {
    // 127.0.0.1 is a potentially trustworthy origin, so the worker registers here exactly
    // as it does over HTTPS on the real host.
    origin: `http://127.0.0.1:${port}${BASE}`,
    refused,
    close: () => new Promise<void>((closed) => {
      server.closeAllConnections();
      server.close(() => closed());
    }),
  };
}

test('the worker installs and the lab renders offline, on a host that refuses dotfiles',
  async ({ context, page }) => {
    const core = await precacheList();
    const host = await startHostStandIn();
    try {
      await page.goto(host.origin, { waitUntil: 'load' });

      // `ready` resolves only once a worker has activated, and activation follows an
      // install that has finished filling the cache. So a rejected `addAll` shows up here
      // as a promise that never settles, rather than as the silent zero-entry cache that
      // shipped. Bounded on purpose: left unbounded it becomes the runner's own 90 s
      // timeout, which names no promise and points at no line.
      const activated = await page.evaluate(() => Promise.race([
        navigator.serviceWorker.ready.then(() => true),
        new Promise<boolean>((settle) => { setTimeout(() => settle(false), 20_000); }),
      ]));
      expect(activated, 'no worker activated — `addAll` rejected, most likely on a 404')
        .toBe(true);

      const state = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        const entries: Record<string, number> = {};
        for (const name of await caches.keys()) {
          entries[name] = (await (await caches.open(name)).keys()).length;
        }
        return { active: registration?.active?.state ?? null, entries };
      });
      expect(state.active, 'the worker must reach activated').toBe('activated');

      // One cache, holding the whole list. Both halves matter: the count catches an
      // install that filled the cache partially, and the single key catches an activate
      // that failed to retire the previous deploy's copy.
      expect(state.entries, `caches after install: ${JSON.stringify(state.entries)}`)
        .toEqual({ [Object.keys(state.entries)[0] ?? '']: core.length });

      // Said plainly rather than inferred from the count, because this is the failure
      // that shipped and the message should name the URL when it comes back.
      const refusedCore = host.refused.filter((path) => core.includes(path));
      expect(refusedCore, `the host refused precached URLs: ${refusedCore.join(', ')}`)
        .toEqual([]);

      // The claim itself: no network at all, and the lab is still there. This is a
      // navigation, so it goes through the worker's shell fallback rather than through
      // the asset path the icon assertions in smoke.spec.ts exercise.
      await context.setOffline(true);
      await page.reload({ waitUntil: 'load' });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Token Tell');
      await expect(page.locator('#hero-experiment')).not.toBeEmpty();
      await expect(page.locator('.thesis-headline')).toContainText(
        'A watermark is not a signature');
    } finally {
      await context.setOffline(false);
      await host.close();
    }
  });
