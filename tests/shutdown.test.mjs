import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Keep this in a separate process so the shutdown request can really exit it.
test('launcher consegue encerrar servidor sem download ativo',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cv15-shutdown-'));
  const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../server.mjs');
  const child=spawn(process.execPath,[app],{
    env:{...process.env,CV_DATA_DIR:path.join(dir,'data'),CV_DOWNLOAD_DIR:path.join(dir,'downloads'),CV_APP_MODE:'launcher',CV_NO_BROWSER:'1',PORT:'0'},
    stdio:['ignore','pipe','pipe']
  });
  try {
    const url=await new Promise((resolve,reject)=>{
      let text='';const timer=setTimeout(()=>reject(new Error('Servidor não iniciou')),10000);
      child.stdout.on('data',b=>{text+=b.toString();const match=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
      child.once('error',reject);child.once('exit',code=>reject(new Error('Servidor saiu cedo: '+code)));
    });
    const state=await (await fetch(url+'/api/state')).json();
    assert.equal(state.appMode,'launcher');
    const response=await fetch(url+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,200);
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Não encerrou')),4000))]);
  }finally{child.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
