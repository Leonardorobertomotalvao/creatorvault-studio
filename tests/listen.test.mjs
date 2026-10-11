import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cv-port-'));
process.env.CV_DATA_DIR=path.join(folder,'data');process.env.CV_DOWNLOAD_DIR=path.join(folder,'downloads');
test('porta ocupada falha claramente e é possível iniciar em outra porta',async()=>{
 const occupied=http.createServer();await new Promise(r=>occupied.listen(0,'127.0.0.1',r));
 const {createApp}=await import('../server.mjs');
 try{
  await assert.rejects(createApp({port:occupied.address().port}),e=>e.code==='EADDRINUSE');
  const app=await createApp();
  assert.equal((await (await fetch(app.url+'/api/health')).json()).app,'creatorvault-studio');
  await new Promise(r=>app.server.close(r));
 }finally{await new Promise(r=>occupied.close(r));fs.rmSync(folder,{recursive:true,force:true});}
});
