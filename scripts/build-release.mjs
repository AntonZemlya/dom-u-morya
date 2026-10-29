import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {optimizeText} from './optimize-release.mjs';
import {RELEASE_FILES} from './release-files.mjs';
import {siteOrigin,generateSEO} from './seo.mjs';

export const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const allowed = new Set(RELEASE_FILES);

async function requireRegularFile(root, relative) {
  if (path.isAbsolute(relative) || relative.split('/').includes('..')) throw new Error(`Unsafe release path: ${relative}`);
  const parts = relative.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const stat = await fs.lstat(path.join(root, ...parts.slice(0, i)));
    if (stat.isSymbolicLink() || (i < parts.length ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Release resources must be regular files/directories: ${relative}`);
    }
  }
}

export async function validateReferences(root) {
  const check = (reference, owner) => {
    const value = reference.trim().replaceAll('&amp;', '&');
    if (!value || value.startsWith('#') || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return;
    const url = new URL(value, `https://release.invalid/${owner}`);
    const relative = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (!allowed.has(relative)) throw new Error(`Unlisted local resource in ${owner}: ${reference}`);
  };
  for (const owner of RELEASE_FILES.filter(name=>name.endsWith('.html'))) {
    const html=await fs.readFile(path.join(root,owner),'utf8');
    for(const match of html.matchAll(/\b(?:src|href|poster)\s*=\s*(["'])(.*?)\1/gs))check(match[2],owner);
    for(const match of html.matchAll(/\bsrcset\s*=\s*(["'])(.*?)\1/gs))for(const candidate of match[2].split(','))check(candidate.trim().split(/\s+/)[0],owner);
    // Include media reached only after interactions, not just initial HTML attributes.
    const payload=html.match(/<script id="site-data" type="application\/json">(.*?)<\/script>/s);
    if(payload){
      const visit=value=>{if(typeof value==='string'&&value.startsWith('assets/')){if(value.includes(', '))value.split(',').forEach(part=>check(part.trim().split(/\s+/)[0],owner));else check(value,owner);}else if(value&&typeof value==='object')Object.values(value).forEach(visit);};
      visit(JSON.parse(payload[1]));
    }
  }
  for (const relative of RELEASE_FILES.filter(name => name.endsWith('.css'))) {
    const css = await fs.readFile(path.join(root, relative), 'utf8');
    for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) check(match[1] ?? match[2] ?? match[3], relative);
  }
  const script = await fs.readFile(path.join(root, 'script.js'), 'utf8');
  for (const match of script.matchAll(/(["'])(assets\/[^'"\r\n]+)\1/g)) check(match[2], 'script.js');
}

async function filesUnder(directory, prefix = '') {
  const names = [];
  for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) names.push(...await filesUnder(path.join(directory, entry.name), relative + '/'));
    else names.push(relative);
  }
  return names.sort();
}

export async function validateRelease(directory) {
  const actual = await filesUnder(directory);
  const expected = [...RELEASE_FILES, 'robots.txt', ...(actual.includes('sitemap.xml') ? ['sitemap.xml'] : [])].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Release file set does not match the allowlist');
  for (const relative of RELEASE_FILES) await requireRegularFile(directory, relative);
  await validateReferences(directory);
  const hash = createHash('sha256');
  let bytes = 0;
  for (const relative of expected) {
    const content = await fs.readFile(path.join(directory, relative));
    bytes += content.length;
    hash.update(relative).update('\0').update(content).update('\0');
  }
  return {directory, files: actual.length, bytes, sha256: hash.digest('hex')};
}

export async function buildRelease({sourceRoot = projectRoot, outputRoot = path.join(sourceRoot, 'dist'), siteUrl=process.env.SITE_URL||'', target=process.env.BUILD_TARGET||'preview'} = {}) {
  const origin=siteOrigin(siteUrl,target);
  sourceRoot = path.resolve(sourceRoot);
  outputRoot = path.resolve(outputRoot);
  if (outputRoot === sourceRoot || sourceRoot.startsWith(outputRoot + path.sep)) throw new Error('Output cannot replace the source tree');
  try {
    const stat = await fs.lstat(outputRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Output must be a directory, not a symlink or file');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const relative of RELEASE_FILES) await requireRegularFile(sourceRoot, relative);
  await validateReferences(sourceRoot);
  await fs.mkdir(path.dirname(outputRoot), {recursive: true});
  const staging = await fs.mkdtemp(path.join(path.dirname(outputRoot), '.release-stage-'));
  try {
    for (const relative of RELEASE_FILES) {
      const target = path.join(staging, relative);
      await fs.mkdir(path.dirname(target), {recursive: true});
      await fs.copyFile(path.join(sourceRoot, relative), target);
    }
    await generateSEO(staging,origin);
    for(const name of ['styles.css','script.js','content-model.js','assets/fonts/fonts.css']) {const file=path.join(staging,name);await fs.writeFile(file,await optimizeText(name,await fs.readFile(file,'utf8')));}
    const result = await validateRelease(staging);
    await fs.rm(outputRoot, {recursive: true, force: true});
    await fs.rename(staging, outputRoot);
    return {...result, directory: outputRoot};
  } finally {
    await fs.rm(staging, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildRelease().then(result => {
    console.log(`${result.directory}: ${result.files} files, ${result.bytes} bytes (${(result.bytes / 1048576).toFixed(2)} MiB)`);
    console.log(`SHA-256 of sorted paths and contents: ${result.sha256}`);
  }).catch(error => { console.error(`Release failed: ${error.message}`); process.exitCode = 1; });
}
