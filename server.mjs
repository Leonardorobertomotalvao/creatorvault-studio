import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { parseYtDlpLine, percentFromProgress } from './lib/progress.mjs';
import { findFinishedMedia, jobTag } from './lib/finalize.mjs';
import { LiveProgress } from './lib/live-progress.mjs';
import { authArgs, normalizeAuth, cookiePath, filterYouTubeCookies, canonicalSource } from './lib/auth.mjs';
import { downloadError } from './lib/errors.mjs';

const APP_VERSION='1.6.0';
let liveServer=null;
const root = path.dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';
const dataRoot = process.env.CV_DATA_DIR || path.join(root, 'data');
const dbFile = path.join(dataRoot, 'creatorvault.json');
const publicDir = path.join(root, 'public');
const ALLOWED_MODES = new Set(['best','2160','1440','1080','720','480','mp3']);
let db = { version: 1, settings: { downloadDir: '' }, projects: [], jobs: [], clips: [] };
let active = null;
let stopped = false;
let writeLock = Promise.resolve();
const clients = new Set();
const MEDIA_EXT = new Set(['.mp4','.mov','.mkv','.avi','.webm','.m4v','.mp3','.wav','.flac','.aac','.ogg']);
let running = false;
let dependencyCache = null;
let queuePaused = false;
let activeClips = 0;
let toolTask = {status:'idle',message:'',log:''};
let toolProcess = null;

function detectDestination() {
  if (process.env.CV_DOWNLOAD_DIR) return path.resolve(process.env.CV_DOWNLOAD_DIR);
  if (isWin) {
    for (const d of ['E','F','G','D']) if (fs.existsSync(`${d}:\\`)) return `${d}:\\CreatorVaultStudio\\Downloads`;
  }
  return path.join(os.homedir(), 'Videos', 'CreatorVaultStudio', 'Downloads');
}
function pickBinary(name) {
  const override = name === 'yt-dlp' ? process.env.CV_YTDLP_PATH : name === 'ffprobe' ? process.env.CV_FFPROBE_PATH : process.env.CV_FFMPEG_PATH;
  if (override) return override;
  const candidates = [path.join(root, 'tools', `${name}${isWin ? '.exe' : ''}`), path.join(root, 'tools', name)];
  const own = candidates.find(p => fs.existsSync(p));
  return own || (isWin ? `${name}.exe` : name);
}
function ffmpegArgs() {
  const local = path.join(root, 'tools', isWin ? 'ffmpeg.exe' : 'ffmpeg');
  return fs.existsSync(local) ? ['--ffmpeg-location', path.dirname(local)] : [];
}
function subprocess(bin, args, { timeoutMs = 30000, maxBytes = 5_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, {windowsHide:true, shell:false, env:{...process.env, PYTHONUTF8:'1', PYTHONIOENCODING:'utf-8'}});
    let stdout='', stderr='', finished=false;
    const outDecoder=new StringDecoder('utf8'), errDecoder=new StringDecoder('utf8');
    const timer = setTimeout(() => { finished=true; killProcess(p); reject(new Error('Tempo excedido ao executar ferramenta.')); }, timeoutMs);
    p.stdout.on('data', b => { if (stdout.length < maxBytes) stdout += outDecoder.write(b); else killProcess(p); });
    p.stderr.on('data', b => { if (stderr.length < maxBytes) stderr += errDecoder.write(b); });
    p.on('error', err => { if (!finished) {finished=true; clearTimeout(timer); reject(err);} });
    p.on('close', code => { if (!finished) {finished=true; clearTimeout(timer); stdout+=outDecoder.end();stderr+=errDecoder.end();code === 0 ? resolve({stdout,stderr}) : reject(new Error((stderr || stdout || `Processo terminou com código ${code}`).slice(-2000)));} });
  });
}
async function deps(refresh = false) {
  if (dependencyCache && !refresh && Date.now() - dependencyCache.checked < 20000) return dependencyCache;
  const [yt, ff] = await Promise.all([
    subprocess(pickBinary('yt-dlp'), ['--version'], {timeoutMs: 8000}).then(x=>({ok:true,version:x.stdout.trim()})).catch(e=>({ok:false,error:e.message})),
    subprocess(pickBinary('ffmpeg'), ['-version'], {timeoutMs: 8000}).then(x=>({ok:true,version:(x.stdout.split('\n')[0]||'').trim()})).catch(e=>({ok:false,error:e.message}))
  ]);
  dependencyCache = {checked:Date.now(),yt,ff}; return dependencyCache;
}
function jsArgs() { return ['--js-runtimes', `node:${process.execPath}`]; }
function commonYtArgs(url) { return ['--ignore-config','--encoding','utf-8','--socket-timeout','30','--retries','3','--fragment-retries','3',...jsArgs(),...authArgs(url,db.settings,dataRoot)]; }
function killProcess(proc) {
  if(!proc?.pid)return;
  if(isWin) {
    const killer=spawn('taskkill.exe',['/PID',String(proc.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false});
    killer.on('error',()=>proc.kill());
  } else proc.kill();
}
function cleanUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Cole uma URL válida.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('URL inválida.'); }
  if (!['http:','https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Somente links públicos HTTP/HTTPS são aceitos.');
  if (/^(localhost|.*\.localhost|.*\.local|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?fc|\[?fd)/i.test(url.hostname)) throw new Error('Endereços de rede privada não são permitidos.');
  return canonicalSource(url.toString());
}
function safeText(value, max=300) { return String(value ?? '').trim().slice(0,max); }
function send(res, code, data) {
  const body=JSON.stringify(data);
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(body);
}
function broadcast(type, value) {
  for(const res of clients) { try { res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`); } catch {clients.delete(res);} }
}
function save() {
  const snapshot=JSON.stringify(db, null, 2);
  const operation=writeLock.catch(()=>{}).then(async()=>{
    await fsp.mkdir(dataRoot,{recursive:true});
    const temp=dbFile+'.tmp';
    await fsp.writeFile(temp,snapshot,'utf8');
    await fsp.rename(temp,dbFile);
  });
  writeLock=operation.catch(e=>console.error('Erro salvando DB:', e.message));
  return operation;
}
async function startData() {
  await fsp.mkdir(dataRoot,{recursive:true});
  try { db={...db,...JSON.parse(await fsp.readFile(dbFile,'utf8'))}; } catch(e) { if(e.code !== 'ENOENT') throw new Error('O histórico não pôde ser lido. Faça uma cópia de data/creatorvault.json antes de recuperar o arquivo. '+e.message); }
  db.settings={...(db.settings||{}),downloadDir:db.settings?.downloadDir||detectDestination(),authentication:normalizeAuth(db.settings?.authentication)};
  if(!Array.isArray(db.projects)) db.projects=[];
  if(!Array.isArray(db.jobs)) db.jobs=[];
  if(!Array.isArray(db.clips)) db.clips=[];
  for(const j of db.jobs) if(j.status==='running') { j.status='interrupted'; j.error='Interrompido ao fechar o aplicativo. Use Tentar novamente.'; }
  for(const j of db.jobs) if(j.status==='failed' && j.error) {
    const detail=downloadError(j.error);
    if(detail.pauseQueue){j.status=detail.status;j.errorCode=detail.code;j.log=j.log||j.error;j.error=detail.message;j.stage='Confirmação necessária';}
  }
  queuePaused=db.jobs.some(j=>['auth_required','blocked'].includes(j.status));
  await fsp.mkdir(db.settings.downloadDir,{recursive:true});
  await save();
}
function chooseFormat(mode) {
  if(mode==='mp3') return ['-f','bestaudio/best','-x','--audio-format','mp3','--audio-quality','0'];
  const q=mode==='best'?null:Number(mode);
  const selector=q ? `bv*[height<=${q}]+ba/b[height<=${q}]/best[height<=${q}]` : 'bv*+ba/b';
  return ['-f',selector,'--merge-output-format','mp4'];
}
function update(job, patch, persist=true) {
  Object.assign(job,patch,{updatedAt:new Date().toISOString()});
  broadcast('job',job);
  if(persist) save().catch(e=>broadcast('notice',{error:'Não foi possível salvar o histórico: '+e.message}));
}
function queueLoop() {
  if(active || stopped || queuePaused || toolTask.status==='running') return;
  const next=db.jobs.findLast(j=>j.status==='queued');
  if(next) {
    try {runJob(next);} catch(e) {
      const detail=downloadError(e.message);queuePaused=!!detail.pauseQueue;
      update(next,{status:detail.status,error:detail.message,errorCode:detail.code,stage:'Falhou'});
      if(!queuePaused)setImmediate(queueLoop);
    }
  }
}
/** One worker; transfers have a job-specific prefix so completion never depends on stdout alone. */
function runJob(job) {
  const bin=pickBinary('yt-dlp');
  const project=db.projects.find(p=>p.id===job.projectId);
  const folder=path.join(db.settings.downloadDir,project ? `${safeDir(project.name)}-${project.id.slice(0,8)}` : 'Avulsos');
  fs.mkdirSync(folder,{recursive:true});
  const prefix=jobTag(job.id);
  const template=path.join(folder, `${prefix}%(title).120B [%(id)s] [${job.mode}].%(ext)s`);
  const args=[
    '--no-playlist','--newline','--no-colors','--windows-filenames',
    '--progress-delta','0.2',
    '--progress-template','download:CV_PROGRESS:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.status)s|%(progress.filename)s',
    '--no-simulate',...commonYtArgs(job.url),...ffmpegArgs(),...chooseFormat(job.mode),
    '-o',template,'--print','after_move:CV_FINAL:%(filepath)s',job.url
  ];
  const proc=spawn(bin,args,{windowsHide:true,shell:false,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
  active={jobId:job.id,process:proc};
  update(job,{status:'running',progress:0,error:'',log:'',warning:'',filePath:'',
    stage:'Iniciando',errorCode:'',downloadedBytes:0,totalBytes:0,speed:'',eta:'',exitCode:null,progressSource:'iniciando',startedAt:new Date().toISOString()});
  let cancelled=false, lastUI=0,lastSave=0,tail='',logError='',emittedFinal=[];
  const meter=new LiveProgress();
  let diskBusy=false;
  // Fall back to bytes written on disk if yt-dlp doesn't emit machine-readable progress.
  const diskTicker=setInterval(async()=>{
    if(diskBusy || cancelled || job.status!=='running' || active?.jobId!==job.id)return;
    if(meter.hasNetworkData && Date.now()-meter.lastEventAt<2000)return;
    diskBusy=true;
    try {
      const {bytes,bytesPerSec}=await meter.sampleFiles(folder,prefix);
      if(bytes>0 && !cancelled && active?.jobId===job.id) {
        const current=Math.max(job.downloadedBytes||0,bytes);
        const patch={downloadedBytes:current,progressSource:'disco',
          stage:meter.hasNetworkData?'Aguardando dados de progresso':'Gravando no disco',
          progressUpdatedAt:new Date().toISOString()};
        if(bytesPerSec!=null)patch.speed=(bytesPerSec/1024/1024).toFixed(2)+' MiB/s (disco)';
        if(current !== job.downloadedBytes || patch.speed) update(job,patch,false);
      }
    } catch(e) { /* Some file systems may lock an in-progress file. Next tick retries. */ }
    finally {diskBusy=false;}
  },900);
  diskTicker.unref();
  const consume=line=>{
    if(!line.trim())return;
    const parsed=parseYtDlpLine(line);
    if(parsed.kind==='final') {
      emittedFinal.push(parsed.filePath);
      update(job,{stage:'Verificando arquivo'},false);
    } else if(parsed.kind==='progress') {
      const now=Date.now();
      const live=meter.receive(parsed,now);
      const pct=percentFromProgress(live.progress,job.progress||0);
      const patch={...live,progress:pct};
      patch.downloadedBytes=Math.max(job.downloadedBytes||0,live.downloadedBytes||0);
      patch.totalBytes=Math.max(job.totalBytes||0,live.totalBytes||0,patch.downloadedBytes);
      // Throttled, but does not debounce forever while data is streaming.
      if(now-lastUI>=160 || pct===100) {
        lastUI=now;
        update(job,patch,now-lastSave>2500);
        if(now-lastSave>2500)lastSave=now;
      }
    } else if(parsed.kind==='stage') {
      update(job,{stage:parsed.stage},false);
    } else if(parsed.kind==='error') {
      logError=parsed.detail;
      update(job,{lastMessage:logError},false);
    }
    if(parsed.kind!=='progress') tail=(tail+'\n'+line).slice(-5000);
  };
  function capture(stream) {
    const decoder=new StringDecoder('utf8');
    let buffer='';
    stream.on('data',chunk=>{
      buffer+=decoder.write(chunk);
      const lines=buffer.split(/[\r\n]+/);
      buffer=lines.pop()||'';
      for(const line of lines)consume(line);
      if(buffer.length>12000)buffer=buffer.slice(-4000);
    });
    return ()=>{buffer+=decoder.end();if(buffer.trim())consume(buffer);};
  }
  const finishStdout=capture(proc.stdout), finishStderr=capture(proc.stderr);
  proc.on('error',e=>{logError=e.message;});
  proc.on('close', async(code, signal)=>{
    clearInterval(diskTicker);
    finishStdout();finishStderr();
    try {
      if(cancelled || job.status==='cancelled') {
        update(job,{status:'cancelled',stage:'Cancelado',exitCode:code,error:''});
        return;
      }
      const found=await findFinishedMedia({folder,jobTag:prefix,reportedPaths:emittedFinal});
      const common={exitCode:code,stage:'',speed:'',eta:'',lastMessage:logError,log:tail.slice(-2000)};
      if(found && code===0) {
        update(job,{...common,status:'completed',stage:'Concluído',progress:100,
          filePath:found.filePath,fileSizeBytes:found.sizeBytes,
          downloadedBytes:found.sizeBytes,totalBytes:found.sizeBytes,
          finishedAt:new Date().toISOString(),error:'',warning:''});
      } else if(found) {
        update(job,{...common,status:'review',stage:'Arquivo encontrado — verificar',progress:100,
          filePath:found.filePath,fileSizeBytes:found.sizeBytes,
          error:'',warning:`Foi encontrado um arquivo de ${Math.round(found.sizeBytes/1024)} KB, mas a ferramenta retornou código ${code ?? signal}. Confira a reprodução antes de usar.`});
      } else {
        const detail=downloadError(logError || tail || `Não foi encontrado um arquivo final válido. Código ${code ?? signal}.`);
        if(detail.pauseQueue)queuePaused=true;
        update(job,{...common,status:detail.status,stage:detail.pauseQueue?'Aguardando confirmação':'Falhou',error:detail.message,errorCode:detail.code});
      }
    }catch(e){update(job,{status:'failed',stage:'Falhou',error:`Falha ao verificar arquivo final: ${e.message}`});}
    finally{active=null;queueMicrotask(queueLoop);}
  });
  active.cancel=()=>{cancelled=true;clearInterval(diskTicker);update(job,{status:'cancelled',stage:'Cancelado',error:''});killProcess(proc);};
}
function safeDir(name) { return name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,80) || 'Projeto'; }
function videoDate(x) { if(typeof x==='number' && x>=0 && x<12*3600) return x; if(typeof x!=='string') return NaN; const a=x.trim().split(':').map(Number);if(a.length>3||a.some(n=>!Number.isFinite(n)||n<0))return NaN;return a.reduce((t,n)=>t*60+n,0); }
async function readBody(req,maxBytes=50_000) {return await new Promise((resolve,reject)=>{
  let s='',bytes=0;const decoder=new StringDecoder('utf8');req.on('data',b=>{bytes+=b.length;s+=decoder.write(b);if(bytes>maxBytes){reject(new Error('Dados excessivos.'));req.destroy();}});
  req.on('end',()=>{try{resolve(JSON.parse(s+decoder.end()||'{}'));}catch{reject(new Error('JSON inválido.'));}});req.on('error',reject);
});}
function ownOrigin(req) {
  const origin=req.headers.origin;
  if(!origin) return true;
  try {const u=new URL(origin);const host=req.headers.host;return u.host===host && (u.protocol==='http:'||u.protocol==='https:');}catch{return false;}
}
function publicSettings() {
  return {...db.settings,authentication:{...normalizeAuth(db.settings.authentication),hasCookiesFile:fs.existsSync(cookiePath(dataRoot))}};
}
function installTools() {
  if(!isWin)throw new Error('A instalação pelo painel está disponível na versão Windows.');
  if(toolTask.status==='running')throw new Error('Uma instalação já está em andamento.');
  if(active||activeClips)throw new Error('Aguarde ou cancele o processamento antes de atualizar ferramentas.');
  toolTask={status:'running',message:'Baixando ferramentas. Você pode acompanhar aqui.',log:''};
  broadcast('tools',toolTask);
  const proc=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'INSTALAR_FERRAMENTAS.ps1'),'-NonInteractive'],{windowsHide:true,shell:false});
  toolProcess=proc;
  const decoder=new StringDecoder('utf8');
  const capture=chunk=>{toolTask.log=(toolTask.log+decoder.write(chunk)).slice(-8000);broadcast('tools',toolTask);};
  proc.stdout.on('data',capture);proc.stderr.on('data',capture);
  proc.on('error',e=>{toolTask.message='Não foi possível iniciar a instalação: '+e.message;});
  proc.on('close',async code=>{
    toolProcess=null;dependencyCache=null;
    toolTask.log+=decoder.end();
    toolTask.status=code===0?'completed':'failed';
    toolTask.message=code===0?'Ferramentas instaladas. Você já pode baixar e recortar.':'A instalação não foi concluída. Confira os detalhes e tente novamente.';
    broadcast('tools',toolTask);broadcast('state',{});
    queueLoop();
  });
}
async function importMedia(req,res) {
  if(!ownOrigin(req)) return send(res,403,{error:'Origem não autorizada.'});
  const filename=safeText(decodeURIComponent(String(req.headers['x-file-name']||'')),200);
  const ext=path.extname(filename).toLowerCase();
  if(!MEDIA_EXT.has(ext))throw new Error('Tipo de mídia não compatível.');
  if(req.headers['x-authorized']!=='true')throw new Error('Confirme os direitos de uso deste arquivo.');
  const projectId=String(req.headers['x-project-id']||'');
  if(projectId && !db.projects.some(p=>p.id===projectId))throw new Error('Projeto inexistente.');
  const len=Number(req.headers['content-length']||0);
  const max=10*1024**3;
  if(len>max)throw new Error('O tamanho máximo por importação é 10 GB.');
  const folder=path.join(db.settings.downloadDir,'Importados');
  await fsp.mkdir(folder,{recursive:true});
  const target=path.join(folder,`${safeDir(path.parse(filename).name).slice(0,95)}-${randomUUID().slice(0,8)}${ext}`);
  const tmp=target+'.partial';
  let bytes=0;
  const limiter=new Transform({transform(chunk,enc,cb){bytes+=chunk.length;cb(bytes>max?new Error('Limite de 10 GB excedido.'):null,chunk);}});
  try {await pipeline(req,limiter,fs.createWriteStream(tmp,{flags:'wx'}));if(!bytes)throw new Error('Arquivo vazio.');await fsp.rename(tmp,target);}
  catch(e){await fsp.rm(tmp,{force:true}).catch(()=>{});throw e;}
  const j={id:randomUUID(),url:'',mode:'imported',projectId:projectId||null,title:safeText(filename,200),license:safeText(decodeURIComponent(String(req.headers['x-license']||'')),300),author:safeText(decodeURIComponent(String(req.headers['x-author']||'')),200),status:'completed',progress:100,filePath:target,error:'',log:'',stage:'Importado',sourceType:'local',createdAt:new Date().toISOString()};
  db.jobs.unshift(j);await save();broadcast('state',{});return send(res,201,j);
}
async function route(req,res) {
  const u=new URL(req.url, 'http://localhost');
  const address=liveServer?.address();
  if(!address || req.headers.host!==`127.0.0.1:${address.port}` || !ownOrigin(req) || req.headers['sec-fetch-site']==='cross-site') return send(res,403,{error:'Origem não autorizada.'});
  if(req.method==='GET' && u.pathname==='/api/health') return send(res,200,{app:'creatorvault-studio',version:APP_VERSION,instance:process.env.CV_INSTANCE_ID||''});
  if(req.method==='GET' && u.pathname==='/api/events') {
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write(`event: hello\ndata: ${JSON.stringify({ready:true})}\n\n`);clients.add(res);
    const pulse=setInterval(()=>res.write(': heartbeat\n\n'),20000);pulse.unref();
    req.on('close',()=>{clearInterval(pulse);clients.delete(res);});return;
  }
  if(req.method==='GET' && u.pathname==='/api/state') return send(res,200,{version:APP_VERSION,jobs:db.jobs,projects:db.projects,clips:db.clips,settings:publicSettings(),dependencies:await deps(),toolTask,queuePaused,appMode:process.env.CV_APP_MODE||'browser'});
  if(req.method==='GET' && u.pathname==='/api/status') return send(res,200,{dependencies:await deps(true)});
  if(req.method==='POST' && u.pathname==='/api/shutdown') {
    if(!ownOrigin(req))return send(res,403,{error:'Origem não autorizada.'});
    if(process.env.CV_APP_MODE!=='launcher')return send(res,403,{error:'Encerramento pelo painel disponível somente no aplicativo.'});
    if(active || activeClips || toolProcess || db.jobs.some(j=>j.status==='queued'))return send(res,409,{error:'Existe um processamento em andamento ou aguardando. Cancele-o ou aguarde antes de encerrar.'});
    await writeLock;
    send(res,200,{ok:true});
    setImmediate(()=>{
      for(const client of clients) { try {client.end();}catch {} }
      liveServer?.close(()=>process.exit(0));
      setTimeout(()=>process.exit(0),1200).unref();
    });
    return;
  }
  if(req.method==='POST' && u.pathname==='/api/import') return await importMedia(req,res);
  if(req.method==='POST') {
    if(!ownOrigin(req)) return send(res,403,{error:'Origem não autorizada.'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return send(res,415,{error:'Envie dados JSON.'});
    const b=await readBody(req,u.pathname==='/api/auth/cookies'?2_050_000:50_000);
    if(u.pathname==='/api/tools/install'){installTools();return send(res,202,toolTask);}
    if(u.pathname==='/api/settings') {
      if(active||activeClips)throw new Error('Aguarde ou cancele o processamento antes de mudar as configurações.');
      const settings={...db.settings};
      if(b.downloadDir!==undefined) {
        const folder=safeText(b.downloadDir,1024);
        if(!path.isAbsolute(folder)||/[\0\r\n]/.test(folder))throw new Error('Informe um caminho absoluto para a pasta de destino.');
        await fsp.mkdir(folder,{recursive:true});await fsp.access(folder,fs.constants.W_OK);
        settings.downloadDir=path.resolve(folder);
      }
      if(b.authentication!==undefined) {
        settings.authentication=normalizeAuth(b.authentication);
        if(settings.authentication.method==='file' && !fs.existsSync(cookiePath(dataRoot)))throw new Error('Importe cookies.txt antes de selecionar essa opção.');
      }
      db.settings=settings;await save();broadcast('state',{});return send(res,200,publicSettings());
    }
    if(u.pathname==='/api/auth/cookies') {
      if(active)throw new Error('Aguarde ou cancele o download antes de trocar os cookies.');
      const cookies=filterYouTubeCookies(b.text);
      const target=cookiePath(dataRoot);await fsp.mkdir(path.dirname(target),{recursive:true,mode:0o700});
      await fsp.writeFile(target+'.tmp',cookies.text,{mode:0o600});await fsp.rename(target+'.tmp',target);
      db.settings.authentication={...normalizeAuth(db.settings.authentication),method:'file'};
      await save();broadcast('state',{});return send(res,200,{ok:true,count:cookies.count});
    }
    if(u.pathname==='/api/queue/resume') {
      queuePaused=false;queueLoop();broadcast('state',{});return send(res,200,{ok:true});
    }
    if(u.pathname==='/api/inspect') {
      const url=cleanUrl(b.url);
      let p;
      try {p=await subprocess(pickBinary('yt-dlp'),['--dump-single-json','--no-playlist','--skip-download','--no-warnings',...commonYtArgs(url),url],{timeoutMs:90000,maxBytes:12_000_000});}
      catch(e){const detail=downloadError(e.message);return send(res,400,{error:detail.message,errorCode:detail.code});}
      let meta;try{meta=JSON.parse(p.stdout);}catch{throw new Error('Não foi possível interpretar metadados.');}
      return send(res,200,{title:safeText(meta.title,250),channel:safeText(meta.uploader||meta.channel),duration:meta.duration ?? null,thumbnail:typeof meta.thumbnail==='string' && /^https:/.test(meta.thumbnail)?meta.thumbnail:null,formats:[...new Set((meta.formats||[]).filter(f=>f.vcodec && f.vcodec!=='none' && Number(f.height)>0).map(f=>Number(f.height)))].sort((a,b)=>b-a).slice(0,20),id:safeText(meta.id)});
    }
    if(u.pathname==='/api/projects') {
      const name=safeText(b.name,80);if(!name)throw new Error('Informe nome do projeto.');
      const project={id:randomUUID(),name,description:safeText(b.description,500),createdAt:new Date().toISOString()};db.projects.push(project);await save();broadcast('state',{});return send(res,201,project);
    }
    if(u.pathname==='/api/jobs') {
      const url=cleanUrl(b.url), mode=safeText(b.mode,10);
      if(!ALLOWED_MODES.has(mode))throw new Error('Qualidade inválida.');
      if(b.projectId && !db.projects.some(p=>p.id===b.projectId))throw new Error('Projeto inexistente.');
      if(!b.authorized) throw new Error('Confirme que a obtenção do conteúdo é permitida.');
      if(db.jobs.some(j=>j.url && canonicalSource(j.url)===url && j.mode===mode)) throw new Error('Esse vídeo já tem uma tarefa nessa qualidade. Use Tentar novamente na tarefa existente.');
      if(toolTask.status==='running')throw new Error('Aguarde a instalação das ferramentas.');
      const tools=await deps();if(!tools.yt.ok||!tools.ff.ok)throw new Error('Instale as ferramentas em Configurações antes de baixar.');
      const j={id:randomUUID(),url,mode,projectId:b.projectId||null,title:safeText(b.title,250)||url,license:safeText(b.license,300),author:safeText(b.author,200),status:'queued',progress:0,filePath:'',error:'',log:'',stage:'Na fila',downloadedBytes:0,totalBytes:0,speed:'',eta:'',createdAt:new Date().toISOString()};db.jobs.unshift(j);await save();broadcast('job',j);queueLoop();return send(res,201,j);
    }
    const action=u.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/(retry|cancel)$/);
    if(action){ const j=db.jobs.find(x=>x.id===action[1]);if(!j)throw new Error('Tarefa inexistente.');
      if(action[2]==='cancel') {if(active?.jobId===j.id)active.cancel();else if(j.status==='queued')update(j,{status:'cancelled',stage:'Cancelado'});else throw new Error('Essa tarefa não está ativa.');}
      else {
        if(active?.jobId===j.id)throw new Error('O processo ainda está encerrando. Aguarde um instante antes de tentar novamente.');
        if(!['failed','cancelled','interrupted','review','auth_required','blocked'].includes(j.status))throw new Error('Esta tarefa não pode ser repetida.');
        if(b.mode!==undefined){if(!ALLOWED_MODES.has(b.mode))throw new Error('Qualidade inválida.');j.mode=b.mode;}
        if(db.jobs.some(other=>other.id!==j.id && other.url && canonicalSource(other.url)===canonicalSource(j.url) && other.mode===j.mode && ['queued','running','completed'].includes(other.status)))throw new Error('Outra tarefa desse vídeo já está ativa ou concluída.');
        queuePaused=false;update(j,{status:'queued',progress:0,error:'',errorCode:'',warning:'',log:'',stage:'Na fila',downloadedBytes:0,totalBytes:0,speed:'',eta:''});queueLoop();
      }
      return send(res,200,j);
    }
    if(u.pathname==='/api/clips') {
      const j=db.jobs.find(x=>x.id===b.jobId);
      if(!j || j.status!=='completed' || !j.filePath || !fs.existsSync(j.filePath))throw new Error('Selecione um arquivo concluído que ainda exista.');
      if(!/\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(j.filePath))throw new Error('Escolha um arquivo de vídeo para criar o corte.');
      const a=videoDate(b.start),z=videoDate(b.end);if(!Number.isFinite(a)||!Number.isFinite(z)||z<=a||z-a>3600)throw new Error('Informe início e fim válidos, com duração até 1 hora.');
      const clipDir=path.join(db.settings.downloadDir,'Cortes');await fsp.mkdir(clipDir,{recursive:true});
      const dst=path.join(clipDir,`${safeDir(path.parse(j.filePath).name).slice(0,60)}_corte_${randomUUID().slice(0,6)}.mp4`);
      activeClips++;
      try {await subprocess(pickBinary('ffmpeg'),['-hide_banner','-loglevel','error','-y','-ss',String(a),'-i',j.filePath,'-t',String(z-a),'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k',dst],{timeoutMs:3600_000});}
      catch(e){await fsp.rm(dst,{force:true}).catch(()=>{});throw e;}finally{activeClips--;}
      const clip={id:randomUUID(),jobId:j.id,path:dst,from:a,to:z,createdAt:new Date().toISOString()};db.clips.unshift(clip);await save();broadcast('state',{});return send(res,201,clip);
    }
  }
  if(req.method==='GET') {
    const name=u.pathname==='/' ? '/index.html':u.pathname;
    if(['/index.html','/app.js','/style.css'].includes(name)) {
      const file=path.join(publicDir,name);
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
      res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' https: data:; connect-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
      fs.createReadStream(file).pipe(res);return;
    }
  }
  send(res,404,{error:'Rota não encontrada.'});
}
export async function createApp({port=0, openBrowser=false}={}) {
  if(running)throw new Error('O servidor já está aberto.');
  await startData();running=true;stopped=false;
  const server=http.createServer((req,res)=>route(req,res).catch(e=>{ console.error(e.message);if(!res.headersSent)send(res,400,{error:e.message});else res.end();}));
  liveServer=server;
  server.on('close',()=>{stopped=true;running=false;liveServer=null;});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});}).catch(e=>{running=false;liveServer=null;throw e;});
  const addr=server.address();const url=`http://127.0.0.1:${addr.port}`;
  console.log(`CreatorVault Studio v${APP_VERSION} aberto em ${url}`);
  console.log('CV_READY:'+JSON.stringify({url,instance:process.env.CV_INSTANCE_ID||''}));
  queueMicrotask(queueLoop);
  if(openBrowser && process.env.CV_NO_BROWSER!=='1') {
    const bin=isWin?'cmd':process.platform==='darwin'?'open':'xdg-open';
    const finalArgs=isWin?['/c','start','',url]:process.platform==='darwin'?[url]:[url];
    try { const p=spawn(bin,finalArgs,{detached:true,stdio:'ignore',windowsHide:true});p.on('error',()=>console.log('Abra o endereço manualmente:',url));p.unref(); }catch{console.log('Abra o endereço manualmente:',url);}
  }
  return {server,url,flush:()=>writeLock};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  createApp({port:Number(process.env.PORT||0),openBrowser:true}).catch(e=>{console.error(e);process.exitCode=1;});
}
