import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('banco inválido é preservado em vez de sobrescrito',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cv-invalid-db-'));
 const data=path.join(folder,'data');fs.mkdirSync(data);
 const file=path.join(data,'creatorvault.json');fs.writeFileSync(file,'{ invalid original data');
 const server=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../server.mjs');
 const child=spawn(process.execPath,[server],{env:{...process.env,CV_NO_BROWSER:'1',CV_DATA_DIR:data,CV_DOWNLOAD_DIR:path.join(folder,'downloads')}});
 let stderr='';child.stderr.on('data',b=>stderr+=b.toString());
 const exitCode=await new Promise(resolve=>child.once('exit',resolve));
 assert.equal(exitCode,1);assert.match(stderr,/histórico não pôde ser lido/);assert.equal(fs.readFileSync(file,'utf8'),'{ invalid original data');
 fs.rmSync(folder,{recursive:true,force:true});
});
