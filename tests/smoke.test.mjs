import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cvstudio-test-'));
process.env.CV_DATA_DIR=path.join(folder,'data');
process.env.CV_DOWNLOAD_DIR=path.join(folder,'downloads');
let server, base, flush;
if(process.platform!=='win32'){
  const yt=path.join(folder,'yt-mock');
  fs.writeFileSync(yt,`#!/usr/bin/env node
const fs=require('node:fs'); const path=require('node:path'); const a=process.argv.slice(2);
if(a.includes('--version')){console.log('2026.mock');process.exit(0)}
if(a.includes('--dump-single-json')){console.log(JSON.stringify({id:'abc',title:'Mídia de teste',channel:'Canal autorizado',formats:[{height:1080,vcodec:'h264'}]}));process.exit(0)}
const tmpl=a[a.indexOf('-o')+1]; const file=tmpl.replace('%(title).120B','Midia').replace('%(id)s','abc').replace('%(ext)s','mp4');
const url=a[a.length-1];
fs.mkdirSync(path.dirname(file),{recursive:true});
if(url.includes('silent-progress')){
  fs.writeFileSync(file+'.part',Buffer.alloc(16384,3));
  setTimeout(()=>{
    fs.appendFileSync(file+'.part',Buffer.alloc(16384,3));
    setTimeout(()=>{
      fs.renameSync(file+'.part',file);
      console.log('CV_FINAL:'+file);
    },1500);
  },1100);
}
else {
console.log('CV_PROGRESS:10.0%|1048576|10485760|NA|2.5MiB/s|00:04|downloading');
setTimeout(()=>{
  console.log('CV_PROGRESS:50.0%|5242880|10485760|NA|2.5MiB/s|00:02|downloading');
  setTimeout(()=>{
    if(url.includes('only-part')){
      fs.writeFileSync(file+'.part','incompleto');
      console.error('ERROR: Download interrumpido');process.exit(1);
    }
    fs.writeFileSync(file,Buffer.alloc(32768,42));
    console.log('CV_PROGRESS:100.0%|10485760|10485760|NA|NA|NA|finished');
    if(!url.includes('video_without_final'))console.log('yt-dlp: CV_FINAL:'+file);
    if(url.includes('video_error_after_file')){console.error('ERROR: erro posterior');process.exit(1);}
  },250);
},250);
}
`);fs.chmodSync(yt,0o755);
  const ff=path.join(folder,'ffmock');
  fs.writeFileSync(ff,`#!/usr/bin/env node
const fs=require('node:fs'); const a=process.argv.slice(2);
if(a.includes('-version')){console.log('ffmpeg version mock');process.exit(0)}
fs.writeFileSync(a[a.length-1], 'recorte simulado');
`);fs.chmodSync(ff,0o755);
  process.env.CV_YTDLP_PATH=yt;process.env.CV_FFMPEG_PATH=ff;
}
const {createApp}=await import('../server.mjs');
const api=async(url,body)=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();return {httpStatus:r.status,...data,data};};
before(async()=>{const app=await createApp();server=app.server;base=app.url;flush=app.flush;});
after(async()=>{await flush();await new Promise(r=>server.close(r));fs.rmSync(folder,{recursive:true,force:true});});
test('servidor responde painel',async()=>{const resp=await fetch(base+'/');assert.equal(resp.status,200);assert.match(await resp.text(),/CreatorVault/)});
test('banco e projetos',async()=>{const initial=await api('/api/state');assert.equal(initial.version,'1.6.0');const p=await api('/api/projects',{name:'Documentário ILL',description:'Teste'});assert.equal(p.httpStatus,201);assert.equal((await api('/api/state')).projects.length,1);});
test('bloqueia download sem confirmação',async()=>{const r=await api('/api/jobs',{url:'https://example.com/video',mode:'1080',authorized:false});assert.equal(r.httpStatus,400);assert.match(r.error,/Confirme/);});
test('bloqueia URL local e formatos maliciosos',async()=>{const r=await api('/api/jobs',{url:'http://127.0.0.1/private',mode:'1080',authorized:true});assert.equal(r.httpStatus,400);const other=await api('/api/jobs',{url:'https://example.com/video',mode:'; rm -rf /',authorized:true});assert.equal(other.httpStatus,400);});
test('importação local cria item na biblioteca',async()=>{
  const bytes=Buffer.from('conteúdo de teste autorizado');
  const r=await fetch(base+'/api/import',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent('Meu video.mp4'),'X-Authorized':'true','X-Author':encodeURIComponent('MONTZ'),'X-License':encodeURIComponent('Obra própria')},body:bytes});
  const job=await r.json();
  assert.equal(r.status,201,job.error);
  assert.equal(job.status,'completed');
  assert.equal(job.mode,'imported');
  assert.ok(fs.existsSync(job.filePath));
  assert.equal(fs.readFileSync(job.filePath,'utf8'),'conteúdo de teste autorizado');
});
test('inspeção, fila, recorte e duplicatas', {skip:process.platform==='win32'}, async()=>{
  const meta=await api('/api/inspect',{url:'https://example.com/vid'});assert.equal(meta.title,'Mídia de teste');
  const job=await api('/api/jobs',{url:'https://example.com/vid',mode:'1080',authorized:true,title:meta.title,license:'Autorizado'});assert.equal(job.httpStatus,201);
  const dup=await api('/api/jobs',{url:'https://example.com/vid',mode:'1080',authorized:true});assert.equal(dup.httpStatus,400);
  let final;for(let i=0;i<80;i++){const s=await api('/api/state');final=s.jobs.find(j=>j.id===job.id);if(final.status==='completed')break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(final.status,'completed',final.error);assert.ok(fs.existsSync(final.filePath));
  const clip=await api('/api/clips',{jobId:job.id,start:'00:00:02',end:'00:00:07'});assert.equal(clip.httpStatus,201);assert.ok(fs.existsSync(clip.path));
});

test('progresso aparece durante a transferência, antes do arquivo estar pronto', {skip:process.platform==='win32'}, async()=>{
  const job=await api('/api/jobs',{url:'https://example.com/progresso',mode:'720',authorized:true,title:'Teste progressivo'});
  assert.equal(job.httpStatus,201);
  let intermediate=null;let final=null;
  for(let i=0;i<60;i++){
    final=(await api('/api/state')).jobs.find(j=>j.id===job.id);
    if(final.status==='running' && final.progress>=10 && final.progress<100){intermediate=final;break;}
    await new Promise(r=>setTimeout(r,50));
  }
  assert.ok(intermediate,'Deveria existir progresso antes da conclusão');
  assert.ok(intermediate.downloadedBytes>=1048576);
  assert.ok(intermediate.totalBytes>=10485760);
  for(let i=0;i<80;i++){
    final=(await api('/api/state')).jobs.find(j=>j.id===job.id);
    if(final.status==='completed')break;
    await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(final.status,'completed',final.error);assert.equal(final.progress,100);
  assert.ok(final.fileSizeBytes>0);
});
test('separar arquivo pronto de falso erro do processo', {skip:process.platform==='win32'}, async()=>{
  const job=await api('/api/jobs',{url:'https://example.com/video_error_after_file',mode:'720',authorized:true});
  let final;
  for(let i=0;i<80;i++){
    final=(await api('/api/state')).jobs.find(j=>j.id===job.id);
    if(['review','completed','failed'].includes(final.status))break;
    await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(final.status,'review');
  assert.ok(fs.existsSync(final.filePath));
  assert.ok(final.warning.includes('arquivo'));
});
test('finalização recuperada pela pasta, mesmo sem CV_FINAL', {skip:process.platform==='win32'}, async()=>{
  const job=await api('/api/jobs',{url:'https://example.com/video_without_final',mode:'720',authorized:true});
  let final;
  for(let i=0;i<80;i++){
    final=(await api('/api/state')).jobs.find(j=>j.id===job.id);
    if(['review','completed','failed'].includes(final.status))break;
    await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(final.status,'completed',final.error);
  assert.ok(fs.existsSync(final.filePath));
});
test('arquivo parcial não pode ser considerado concluído', {skip:process.platform==='win32'}, async()=>{
  const job=await api('/api/jobs',{url:'https://example.com/only-part',mode:'720',authorized:true});
  let final;
  for(let i=0;i<80;i++){
    final=(await api('/api/state')).jobs.find(j=>j.id===job.id);
    if(['review','completed','failed'].includes(final.status))break;
    await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(final.status,'failed');
  assert.equal(final.filePath,'');
});

test('progresso estimado pelo arquivo parcial quando yt-dlp não envia porcentagem', {skip:process.platform==='win32'}, async()=>{
  const job=await api('/api/jobs',{url:'https://example.com/silent-progress',mode:'480',authorized:true});
  let sample=null,final=null;
  for(let i=0;i<80;i++){
    final=(await api('/api/state')).jobs.find(j=>j.id===job.id);
    if(final.status==='running' && final.progressSource==='disco' && final.downloadedBytes>0){sample=final;break;}
    await new Promise(r=>setTimeout(r,60));
  }
  assert.ok(sample,'Deve mostrar bytes no disco mesmo sem eventos da ferramenta');
  assert.ok(sample.downloadedBytes>=16384);
  for(let i=0;i<100;i++){
    final=(await api('/api/state')).jobs.find(j=>j.id===job.id);
    if(final.status==='completed')break;
    await new Promise(r=>setTimeout(r,60));
  }
  assert.equal(final.status,'completed',final.error);
});
