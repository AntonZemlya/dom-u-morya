const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');

(async () => {
  const {buildRelease, validateRelease, projectRoot} = await import('../scripts/build-release.mjs');
  const {RELEASE_FILES} = await import('../scripts/release-files.mjs');
  const {optimizeText} = await import('../scripts/optimize-release.mjs');
  const {seoHTML,SEO_PAGES} = await import('../scripts/seo.mjs');
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'dom-u-morya-release-'));
  const outputRoot = path.join(fixture, 'dist');
  try {
    for (const relative of RELEASE_FILES) {
      await fs.mkdir(path.dirname(path.join(fixture, relative)), {recursive: true});
      await fs.copyFile(path.join(projectRoot, relative), path.join(fixture, relative));
    }
    await fs.mkdir(path.join(fixture, 'docs'));
    await fs.writeFile(path.join(fixture, 'docs/private.txt'), 'fixture only');
    await fs.writeFile(path.join(fixture, '.env'), 'FIXTURE_ONLY=true');
    const first = await buildRelease({sourceRoot: fixture, outputRoot});
    assert.equal(first.files, RELEASE_FILES.length+1);
    await assert.rejects(fs.access(path.join(outputRoot, '.env')));
    await assert.rejects(fs.access(path.join(outputRoot, 'docs')));
    for (const relative of RELEASE_FILES) {
      const original = await fs.readFile(path.join(projectRoot, relative));
      let expected = original;
      if (SEO_PAGES.includes(relative)) expected = Buffer.from(seoHTML(original.toString(), relative, ''));
      if (/\.(js|css)$/.test(relative)) expected = Buffer.from(await optimizeText(relative, original.toString()));
      let actual = await fs.readFile(path.join(outputRoot, relative));
      if (relative === 'index.html') {
        let html = actual.toString();
        for (const script of ['content-model.js', 'script.js']) {
          const optimized = await fs.readFile(path.join(outputRoot, script));
          const version = createHash('sha256').update(optimized).digest('hex').slice(0, 16);
          const src = `src="${script}?v=${version}"`;
          assert.ok(html.includes(src), 'The main page must reference the optimized script version');
          html = html.replace(src, `src="${script}"`);
        }
        actual = Buffer.from(html);
      }
      assert.deepEqual(actual, expected, relative);
    }
    await fs.writeFile(path.join(outputRoot, 'stale.zip'), 'old output');
    await assert.rejects(validateRelease(outputRoot), /allowlist/);
    const second = await buildRelease({sourceRoot: fixture, outputRoot});
    assert.equal(first.sha256, second.sha256, 'Repeated builds must have identical paths and bytes');
    const access = await fs.readFile(path.join(fixture, '.htaccess'), 'utf8');
    await fs.writeFile(path.join(fixture, '.htaccess'), 'RewriteEngine On\nRewriteRule .* https://zhk-dom-umorya.ru/ [R=301,L]\n');
    await assert.rejects(buildRelease({sourceRoot: fixture, outputRoot}), /permanent dotfile guard/);
    assert.equal((await validateRelease(outputRoot)).sha256, first.sha256, 'Missing guard cannot replace the prior complete release');
    await fs.writeFile(path.join(fixture, '.htaccess'), access);
    const css = await fs.readFile(path.join(fixture, 'styles.css'), 'utf8');
    await fs.writeFile(path.join(fixture, 'styles.css'), css + '\n.bad{background:url(./.env)}\n');
    await assert.rejects(buildRelease({sourceRoot: fixture, outputRoot}), /Unlisted local resource/);
    assert.equal((await validateRelease(outputRoot)).sha256, first.sha256, 'A failed build must preserve the previous complete release');
    await fs.writeFile(path.join(fixture, 'styles.css'), css);
    await fs.unlink(path.join(fixture, 'assets/fonts/font-1.ttf'));
    await fs.symlink(path.join(projectRoot, 'assets/fonts/font-1.ttf'), path.join(fixture, 'assets/fonts/font-1.ttf'));
    await assert.rejects(buildRelease({sourceRoot: fixture, outputRoot}), /regular files/);
    await fs.unlink(path.join(fixture, 'assets/fonts/font-1.ttf'));
    await assert.rejects(buildRelease({sourceRoot: fixture, outputRoot}), {code: 'ENOENT'});
    console.log('PASS release allowlist, exact copies, reproducibility, stale cleanup, reference/symlink/missing-file rejection');
  } finally {
    await fs.rm(fixture, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
