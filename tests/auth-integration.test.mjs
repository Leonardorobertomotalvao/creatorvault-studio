import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cv-auth-'));
const argvFile=path.join(dir,'args.jsonl');
process.env.CV_DATA_DIR=path.join(dir,'data');process.env.CV_DOWNLOAD_DIR=path.join(dir,'downloads');
if(process.platform!=='win32'){
  const yt=path.join(dir,'yt');
  fs.writeFileSync(yt,`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),a=process.argv.slice(2);
if(a.includes('--version')){console.log('2026.mock');process.exit(0)}
fs.appendFileSync(${JSON.stringify(argvFile)},JSON.stringify(a)+'\\n');
if(!a.includes('--cookies-from-browser')&&!a.includes('--cookies')){console.error("ERROR: [youtube] Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies");process.exit(1)}
if(a.includes('--dump-single-json')){console.log(JSON.stringify({title:'Mídia com acentuação',channel:'Canal',formats:[]}));process.exit(0)}
const file=a[a.indexOf('-o')+1].replace('%(title).120B','Media').replace('%(id)s','test').replace('%(ext)s','mp4');
fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.alloc(1024));console.log('CV_FINAL:'+file);
`);fs.chmodSync(yt,0o755);process.env.CV_YTDLP_PATH=yt;
  const ff=path.join(dir,'ff');fs.writeFileSync(ff,'#!/usr/bin/env node\nconsole.log("ffmpeg version mock")\n');fs.chmodSync(ff,0o755);process.env.CV_FFMPEG_PATH=ff;
}
let server,base,flush;
before(async()=>{const {createApp}=await import('../server.mjs');const app=await createApp();server=app.server;base=app.url;flush=app.flush;});
after(async()=>{await flush();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
async function api(route,body){const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {httpStatus:response.status,...await response.json()};}
async function jobStatus(id,wanted){for(let n=0;n<80;n++){const job=(await api('/api/state')).jobs.find(j=>j.id===id);if(wanted.includes(job?.status))return job;await new Promise(r=>setTimeout(r,30));}throw Error('Tarefa não chegou ao status esperado');}
test('API não aceita requisições de outra origem',async()=>{
  const r=await fetch(base+'/api/settings',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);
});
test('cookies importados ficam locais e valores não são expostos no estado',async()=>{
  const text='# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2000000000\tSID\tdummy-secret\n.google.com\tTRUE\t/\tTRUE\t2000000000\tSID\tnot-retained\n';
  const r=await api('/api/auth/cookies',{text});assert.equal(r.httpStatus,200);assert.equal(r.count,1);
  const state=await api('/api/state');assert.equal(state.settings.authentication.hasCookiesFile,true);
  assert.doesNotMatch(JSON.stringify(state),/dummy-secret|not-retained/);
  const stored=fs.readFileSync(path.join(dir,'data','private','youtube-cookies.txt'),'utf8');assert.match(stored,/dummy-secret/);assert.doesNotMatch(stored,/not-retained/);
  await api('/api/settings',{authentication:{method:'none'}});
});
test('fila pausa no desafio e repete com os cookies configurados', {skip:process.platform==='win32'},async()=>{
  const first=await api('/api/jobs',{url:'https://youtu.be/abcDEFghI12',mode:'1080',authorized:true});assert.equal(first.httpStatus,201);
  const failed=await jobStatus(first.id,['auth_required']);assert.equal(failed.errorCode,'AUTH_REQUIRED');assert.equal(failed.progress,0);
  assert.equal((await api('/api/state')).queuePaused,true);
  const second=await api('/api/jobs',{url:'https://youtu.be/abcDEFghI13',mode:'720',authorized:true});assert.equal(second.httpStatus,201);
  await new Promise(r=>setTimeout(r,100));assert.equal((await api('/api/state')).jobs.find(j=>j.id===second.id).status,'queued');
  const duplicate=await api('/api/jobs',{url:'https://www.youtube.com/watch?v=abcDEFghI12&t=50',mode:'1080',authorized:true});assert.equal(duplicate.httpStatus,400);
  const saved=await api('/api/settings',{authentication:{method:'browser',browser:'brave',profile:'Default'}});assert.equal(saved.httpStatus,200);
  const inspect=await api('/api/inspect',{url:'https://youtu.be/abcDEFghI12'});assert.equal(inspect.title,'Mídia com acentuação');
  const retry=await api('/api/jobs/'+first.id+'/retry',{});assert.equal(retry.httpStatus,200);
  await jobStatus(first.id,['completed']);await jobStatus(second.id,['completed']);
  const args=fs.readFileSync(argvFile,'utf8').trim().split('\n').map(JSON.parse);
  const inspectArgs=args.find(a=>a.includes('--dump-single-json'));
  assert.equal(inspectArgs[inspectArgs.indexOf('--cookies-from-browser')+1],'brave:Default');
  const downloads=args.filter(a=>a.includes('-o')&&a.includes('--cookies-from-browser'));
  assert.equal(downloads.length,2);assert.ok(downloads.every(a=>a.includes('--no-simulate')&&a.includes('--ignore-config')));
});
test('mudar destino mantém cortes de arquivos já registrados',async()=>{
  const r=await api('/api/settings',{downloadDir:path.join(dir,'new-downloads')});assert.equal(r.httpStatus,200);assert.ok(fs.existsSync(r.downloadDir));
});
