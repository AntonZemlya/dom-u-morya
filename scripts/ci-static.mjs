import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
for(const dir of ['scripts','tests'])for(const name of fs.readdirSync(dir))if(/\.(mjs|cjs)$/.test(name)){
 const p=spawnSync(process.execPath,['--check',path.join(dir,name)],{encoding:'utf8'});if(p.status)throw Error(p.stderr);
}
console.log('PASS all test/build JavaScript syntax');
