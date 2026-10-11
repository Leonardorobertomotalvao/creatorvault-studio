const $ = q => document.querySelector(q);
const $$ = q => [...document.querySelectorAll(q)];
let state={jobs:[],projects:[],clips:[],dependencies:{},settings:{},version:'1.6.0'};
let settingsInitialized=false,refreshing=false;
let inspected=null;
const labels={queued:'Na fila',running:'Baixando',completed:'Concluído',failed:'Falhou',cancelled:'Cancelado',interrupted:'Interrompido',review:'Verificar arquivo',auth_required:'Confirmar acesso',blocked:'Fila pausada'};
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=(s,n=110)=>String(s||'').length>n?String(s).slice(0,n)+'…':String(s||'');
const videoCutEligible=j=>j.status==='completed' && /\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(j.filePath||'');
const prettyMode=m=>m==='best'?'Melhor disponível':m==='mp3'?'MP3':m==='imported'?'Arquivo local':m+'p';
const tabNames={dashboard:'Painel',downloads:'Downloads',library:'Biblioteca',projects:'Projetos',clips:'Cortes',settings:'Configurações'};
async function api(url,body){const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const raw=await r.json();if(!r.ok){const error=Error(raw.error||'Falha na operação');error.code=raw.errorCode;throw error;}return raw;}
let toastTimer;
function notify(msg,error=false){const t=$('#toast');t.textContent=msg;t.classList.toggle('error',error);t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),6500)}
function showTab(tab){$$('.navitem').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));$$('.tab').forEach(x=>x.classList.toggle('hidden',x.dataset.page!==tab));$('#crumb').textContent=(tabNames[tab]||tab).toUpperCase();scrollTo({top:0,behavior:'smooth'});}
async function refresh(){if(refreshing)return;refreshing=true;try{state=await api('/api/state');$('#connectionNotice').classList.add('hidden');render();}catch(e){$('#connectionNotice').classList.remove('hidden');}finally{refreshing=false;}}
function formatBytes(bytes){const b=Number(bytes)||0;if(!b)return '0 B';const u=['B','KB','MB','GB','TB'];let i=0,n=b;while(n>=1024&&i<u.length-1){n/=1024;i++;}return `${n.toFixed(n>=100||i===0?0:n>=10?1:2)} ${u[i]}`;}
function formatEta(raw){
  const txt=String(raw??'').trim();
  if(!txt || /^(NA|unknown|none)$/i.test(txt))return '—';
  if(/^\d{1,2}:\d{2}(?::\d{2})?$/.test(txt))return txt;
  const s=Number(txt);if(!Number.isFinite(s)||s<=0)return '—';
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);
  return h?`${h}h ${m}m`:(m?`${m}m ${sec}s`:`${sec}s`);
}
function formatElapsed(iso){
  if(!iso)return '00:00';
  const seconds=Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/1000));
  if(!Number.isFinite(seconds))return '00:00';
  const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;
  return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function progressText(j){
  const pct=Number(j.progress)||0;
  const current=Number(j.downloadedBytes)>0 ? formatBytes(j.downloadedBytes) : '—';
  const total=Number(j.totalBytes)>0?formatBytes(j.totalBytes):'—';
  if(j.status==='completed')return `100% • ${formatBytes(j.fileSizeBytes||j.totalBytes||j.downloadedBytes)} • Arquivo salvo`;
  if(j.status==='review')return `Arquivo salvo: ${formatBytes(j.fileSizeBytes||0)} • Verifique a reprodução`;
  if(j.status==='queued')return 'Aguardando na fila';
  if(j.status==='auth_required')return 'Aguardando confirmação de acesso ao YouTube';
  if(j.status==='blocked')return 'Aguardando nova tentativa após a limitação do serviço';
  if(j.status==='failed')return `Interrompido • ${pct.toFixed(1)}% transferido`;
  if(j.status==='cancelled')return 'Cancelado pelo usuário';
  if(j.status==='interrupted')return 'Interrompido ao fechar o aplicativo';
  if(j.progressSource==='disco')return `No disco: ${current} • ${j.speed||'Calculando velocidade'} • Tempo: ${formatElapsed(j.startedAt)} • Estimando transferência`;
  if(j.progressSource==='iniciando' && pct===0)return `Preparando conexão... • Tempo: ${formatElapsed(j.startedAt)}`;
  return `${pct.toFixed(1)}% (etapa atual) • ${current} / ${total} • ${j.speed||'Velocidade indisponível'} • Restante: ${formatEta(j.eta)} • Tempo: ${formatElapsed(j.startedAt)}`;
}
function renderStats(){
  const jobs=state.jobs||[], done=jobs.filter(j=>j.status==='completed');
  $('#stats').innerHTML=[['Arquivos concluídos',done.length,'PRONTOS PARA USAR'],['Na fila / baixando',jobs.filter(j=>['queued','running'].includes(j.status)).length,'TAREFAS ATIVAS'],['A verificar',jobs.filter(j=>j.status==='review').length,'ARQUIVOS ENCONTRADOS'],['Projetos',state.projects.length,'ORGANIZAÇÃO']].map(([t,v,h])=>`<div class="stat"><div class="statname">${t}</div><div class="statnum">${v}</div><div class="stathint">${h}</div></div>`).join('');
}
function renderJobs(){
  $('#recent').innerHTML=jobRows((state.jobs||[]).slice(0,5));
  $('#queue').innerHTML=jobRows(state.jobs||[]);
  renderStats();
}
function render(){
  $('#appVersion').textContent=state.version||'1.6.0';
  $('#shutdownBtn').classList.toggle('hidden',state.appMode!=='launcher');
  renderJobs();renderLibrary();renderProjects();renderDeps();renderClips();
  $('#downloadPath').textContent=state.settings?.downloadDir||'Não definido';
  $('#queueNotice').classList.toggle('hidden',!state.queuePaused);
  renderSettings();
}
function jobRows(jobs){
  if(!jobs.length)return '<div class="empty">Nenhuma tarefa. Adicione um link ou importe um arquivo local.</div>';
  return jobs.map(j=>{
    const isRunning=j.status==='running';
    const pct=Math.max(0,Math.min(100,Number(j.progress)||0));
    const diskFallback=j.status==='running'&&['disco','iniciando'].includes(j.progressSource)&&pct===0;
    const showBar=['running','completed','failed','cancelled','interrupted','queued','review','auth_required','blocked'].includes(j.status);
    const diagnostic=[j.warning,j.error,j.lastMessage,j.exitCode!=null?`Código do processo: ${j.exitCode}`:'',j.log].filter(Boolean).join('\n');
    return `<div class="rowitem" data-job-id="${safe(j.id)}"><div class="rowmeta">
      <div class="rowtop"><div class="rowname">${safe(short(j.title))}</div><span class="tag ${safe(j.status)}">${safe(labels[j.status]||j.status)}</span></div>
      <div class="rowsub">${safe(prettyMode(j.mode))} • <span data-job-stage>${safe(j.stage||labels[j.status]||'')}</span></div>
      ${showBar?`<div class="progressline"><progress class="progress" data-job-progress max="100" ${diskFallback?'':`value="${pct}"`} aria-label="Progresso da tarefa">${pct}%</progress><div class="progresstext" data-job-text>${safe(progressText(j))}</div></div>`:''}
      ${j.warning?`<div class="rowsub reviewnote">${safe(j.warning)}</div>`:''}
      ${j.error?`<div class="rowsub warning">${safe(j.error)}</div>`:''}
      ${j.filePath?`<div class="rowsub path" title="${safe(j.filePath)}">${safe(short(j.filePath,150))}</div>`:''}
      ${diagnostic?`<details class="jobdetails"><summary>Detalhes técnicos</summary><pre>${safe(diagnostic)}</pre></details>`:''}
      </div><div class="rowbuttons">
      ${['failed','interrupted','cancelled','review','auth_required','blocked'].includes(j.status)?`<button class="smallbutton" data-action="retry" data-id="${j.id}">Tentar novamente</button>`:''}
      ${j.errorCode==='FORMAT_UNAVAILABLE'?`<button class="smallbutton" data-action="retry-best" data-id="${j.id}">Usar melhor disponível</button>`:''}
      ${['auth_required','blocked'].includes(j.status)||j.errorCode==='TOOLS_MISSING'?`<button class="smallbutton" data-action="configure" data-id="${j.id}">Configurar acesso</button>`:''}
      ${['running','queued'].includes(j.status)?`<button class="smallbutton" data-action="cancel" data-id="${j.id}">Cancelar</button>`:''}
      ${videoCutEligible(j)?`<button class="smallbutton" data-action="clip" data-id="${j.id}">Criar corte</button>`:''}
      ${j.filePath?`<button class="smallbutton" data-action="copy" data-id="${j.id}">Copiar caminho</button>`:''}
      ${j.url?`<button class="smallbutton" data-action="source" data-id="${j.id}">Ver fonte</button>`:''}
      </div></div>`;
  }).join('');
}
function renderLibrary(){const q=$('#searchLibrary').value.trim().toLowerCase();const jobs=state.jobs.filter(j=>j.status==='completed' && (`${j.title} ${j.author} ${j.license}`).toLowerCase().includes(q));
 $('#library').innerHTML=jobs.length?jobs.map(j=>`<div class="librarycard"><div class="libbody"><div class="libtitle">${safe(short(j.title,80))}</div><div class="libmeta">${safe(j.author||'Autor não informado')} • ${safe(prettyMode(j.mode))}</div><div class="libmeta">Licença: ${safe(j.license||'Não informada')}</div><div class="libmeta break" title="${safe(j.filePath)}">${safe(short(j.filePath,72))}</div><div class="rowbuttons">${videoCutEligible(j)?`<button class="smallbutton" data-action="clip" data-id="${j.id}">Recortar</button>`:''}<button class="smallbutton" data-action="copy" data-id="${j.id}">Copiar caminho</button>${j.url?`<button class="smallbutton" data-action="source" data-id="${j.id}">Fonte</button>`:''}</div></div></div>`).join(''):'<div class="empty">Não existem arquivos concluídos correspondentes à pesquisa.</div>';
}
function renderProjects(){const projects=state.projects||[];$('#projectList').innerHTML=projects.length?projects.map(p=>`<div class="projectcard"><strong>${safe(p.name)}</strong><p>${safe(p.description||'Sem descrição')}</p><p>${state.jobs.filter(j=>j.projectId===p.id).length} tarefa(s) vinculada(s)</p></div>`).join(''):'<div class="empty">Nenhum projeto criado ainda.</div>';
 const chosen=$('#projectChoice').value;$('#projectChoice').innerHTML='<option value="">Sem projeto</option>'+projects.map(p=>`<option value="${p.id}">${safe(p.name)}</option>`).join('');$('#projectChoice').value=projects.some(p=>p.id===chosen)?chosen:'';}
function renderDeps(){const d=state.dependencies||{},yt=d.yt||{},ff=d.ff||{};$('#dependencies').innerHTML=`<div class="dep"><span>yt-dlp</span><strong class="${yt.ok?'good':'fail'}">${yt.ok?'OK • '+safe(yt.version):'Não localizado'}</strong></div><div class="dep"><span>FFmpeg</span><strong class="${ff.ok?'good':'fail'}">${ff.ok?'OK':'Não localizado'}</strong></div><div class="dep"><span>Node.js</span><strong class="good">Em execução</strong></div>`;const ok=yt.ok&&ff.ok;$('#dot').className=ok?'ok':'bad';$('#toolState').textContent=ok?'Ferramentas prontas':'Instalação pendente';}
function renderClips(){const chosen=$('#clipVideo').value;$('#clipVideo').innerHTML='<option value="">Selecione um arquivo</option>'+state.jobs.filter(videoCutEligible).map(j=>`<option value="${j.id}">${safe(short(j.title,80))}</option>`).join('');$('#clipVideo').value=state.jobs.some(j=>j.id===chosen)?chosen:'';
 $('#clipList').innerHTML=state.clips?.length?state.clips.slice(0,10).map(c=>`<div class="projectcard"><strong>Corte ${safe(c.from)}s – ${safe(c.to)}s</strong><p class="break">${safe(c.path)}</p></div>`).join(''):'<div class="empty">Os cortes criados aparecerão aqui.</div>';}
function renderSettings(){
 $('#settingsDependencies').innerHTML=$('#dependencies').innerHTML;
 const tools=state.toolTask||{};
 $('#toolsHint').textContent=tools.message||'Na primeira execução, instale as ferramentas por este painel.';
 $('#toolLog').textContent=tools.log||'';
 $('#toolDetails').classList.toggle('hidden',!tools.log);
 $('#installTools').disabled=tools.status==='running';
 $('#installTools').textContent=tools.status==='running'?'Instalando...':'Instalar / atualizar ferramentas';
 $('#addJob').disabled=tools.status==='running'||!state.dependencies?.yt?.ok||!state.dependencies?.ff?.ok;
 $('#cookiesState').textContent=state.settings?.authentication?.hasCookiesFile?'Um arquivo de cookies está disponível neste computador.':'Nenhum arquivo importado.';
 if(!settingsInitialized){
   const auth=state.settings?.authentication||{};
   $('#authMethod').value=auth.method||'none';$('#authBrowser').value=auth.browser||'brave';$('#authProfile').value=auth.profile||'';
   $('#destinationDir').value=state.settings?.downloadDir||'';
   $('#browserAuthFields').classList.toggle('hidden',$('#authMethod').value!=='browser');
   settingsInitialized=true;
   if(!state.dependencies?.yt?.ok||!state.dependencies?.ff?.ok)showTab('settings');
 }
}
function bindSettings(){
 $('#authMethod').onchange=()=>$('#browserAuthFields').classList.toggle('hidden',$('#authMethod').value!=='browser');
 $('#saveAuth').onclick=async()=>{const button=$('#saveAuth');button.disabled=true;try{
   await api('/api/settings',{authentication:{method:$('#authMethod').value,browser:$('#authBrowser').value,profile:$('#authProfile').value}});
   $('#authHint').textContent='Autenticação salva. Use Testar acesso antes de repetir a tarefa.';await refresh();notify('Autenticação salva.');
 }catch(e){notify(e.message,true);}finally{button.disabled=false;}};
 $('#importCookies').onclick=async()=>{const button=$('#importCookies');button.disabled=true;try{
   const file=$('#cookiesFile').files?.[0];if(!file)throw Error('Escolha o arquivo cookies.txt.');
   if(file.size>2_000_000)throw Error('O arquivo deve ter até 2 MB.');
   const result=await api('/api/auth/cookies',{text:await file.text()});$('#cookiesFile').value='';$('#authMethod').value='file';$('#browserAuthFields').classList.add('hidden');
   await refresh();notify(`${result.count} cookies do YouTube importados neste computador.`);
 }catch(e){notify(e.message,true);}finally{button.disabled=false;}};
 $('#testAuth').onclick=async()=>{const button=$('#testAuth');button.disabled=true;$('#authHint').textContent='Testando acesso com a configuração salva...';try{
   const url=$('#authTestUrl').value.trim()||$('#sourceUrl').value.trim();
   const result=await api('/api/inspect',{url});$('#authHint').textContent='Acesso confirmado: '+result.title;
 }catch(e){$('#authHint').textContent=e.message;}finally{button.disabled=false;}};
 $('#saveDestination').onclick=async()=>{const button=$('#saveDestination');button.disabled=true;try{
   await api('/api/settings',{downloadDir:$('#destinationDir').value.trim()});await refresh();notify('Pasta de destino salva.');
 }catch(e){notify(e.message,true);}finally{button.disabled=false;}};
 $('#installTools').onclick=async()=>{try{state.toolTask=await api('/api/tools/install',{});renderSettings();}catch(e){notify(e.message,true);}};
 $('#resumeQueue').onclick=async()=>{try{await api('/api/queue/resume',{});await refresh();}catch(e){notify(e.message,true);}};
}
async function importLocalFile(){
  const file=$('#localFile').files?.[0];
  if(!file) return notify('Escolha um arquivo local primeiro.', true);
  if(!$('#localAuthorized').checked) return notify('Confirme a autorização de uso antes de importar.', true);
  const headers={
    'Content-Type':'application/octet-stream',
    'X-File-Name':encodeURIComponent(file.name),
    'X-Authorized':'true',
    'X-Author':encodeURIComponent($('#sourceAuthor').value||''),
    'X-License':encodeURIComponent($('#license').value||''),
    'X-Project-Id':$('#projectChoice').value||''
  };
  const r=await fetch('/api/import',{method:'POST',headers,body:file});
  const data=await r.json();
  if(!r.ok) throw new Error(data.error||'Falha na importação');
  $('#localFile').value='';
  $('#localAuthorized').checked=false;
  await refresh();
  notify('Arquivo importado para a biblioteca.');
}
function bindEvents(){
 $$('[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
 $('#heroAdd').onclick=()=>showTab('downloads');
 $('#quickProjects').onclick=()=>showTab('projects');
 $('#shutdownBtn').onclick=async()=>{
   if(!confirm('Encerrar o CreatorVault Studio?'))return;
   try {await api('/api/shutdown',{});document.body.innerHTML='<main class="exit-message">CreatorVault Studio encerrado. Pode fechar esta aba.</main>';}
   catch(e){notify(e.message,true);}
 };
 $('#searchLibrary').oninput=renderLibrary;
 $('#inspectBtn').onclick=async()=>{const b=$('#inspectBtn');b.disabled=true;$('#inspectHint').textContent='Analisando...';try{inspected=await api('/api/inspect',{url:$('#sourceUrl').value.trim()});$('#sourceAuthor').value=inspected.channel||'';$('#preview').innerHTML=`<div class="previewcard">${inspected.thumbnail?`<img src="${safe(inspected.thumbnail)}" alt="Miniatura do vídeo">`:''}<div><strong>${safe(inspected.title)}</strong><br>${safe(inspected.channel)}<br>Resoluções detectadas: ${safe(inspected.formats?.map(x=>x+'p').join(' • ')||'Não identificadas')}</div></div>`;$('#inspectHint').textContent='Mídia analisada.';}catch(e){notify(e.message,true);$('#inspectHint').textContent='Não foi possível analisar.';}finally{b.disabled=false;}};
 $('#sourceUrl').oninput=()=>{inspected=null;$('#preview').innerHTML='';};
 $('#addJob').onclick=async()=>{const b=$('#addJob');b.disabled=true;try{await api('/api/jobs',{url:$('#sourceUrl').value.trim(),mode:$('#mode').value,projectId:$('#projectChoice').value,author:$('#sourceAuthor').value,license:$('#license').value,title:inspected?.title||'',authorized:$('#authorized').checked});notify('Vídeo adicionado à fila.');$('#sourceUrl').value='';$('#preview').innerHTML='';inspected=null;await refresh();}catch(e){notify(e.message,true);}finally{b.disabled=false;}};
 $('#newProject').onclick=async()=>{try{await api('/api/projects',{name:$('#projectName').value,description:$('#projectDescription').value});$('#projectName').value='';$('#projectDescription').value='';await refresh();notify('Projeto criado.');}catch(e){notify(e.message,true);}};
 $('#createClip').onclick=async()=>{const b=$('#createClip');b.disabled=true;$('#clipHint').textContent='Processando recorte local...';try{await api('/api/clips',{jobId:$('#clipVideo').value,start:$('#clipStart').value,end:$('#clipEnd').value});$('#clipHint').textContent='Corte concluído.';notify('Trecho exportado para a pasta Cortes.');await refresh();}catch(e){$('#clipHint').textContent=e.message;notify(e.message,true);}finally{b.disabled=false;}};
 $('#importFile').onclick=async()=>{const b=$('#importFile');b.disabled=true;try{await importLocalFile();}catch(e){notify(e.message,true);}finally{b.disabled=false;}};
 document.addEventListener('click',async e=>{const btn=e.target.closest('[data-action]');if(!btn)return;const j=state.jobs.find(x=>x.id===btn.dataset.id);if(!j)return;try{if(['retry','cancel','retry-best'].includes(btn.dataset.action)){await api(`/api/jobs/${j.id}/${btn.dataset.action==='cancel'?'cancel':'retry'}`,btn.dataset.action==='retry-best'?{mode:'best'}:{});await refresh();}else if(btn.dataset.action==='configure'){showTab('settings');$('#authTestUrl').value=j.url||'';}else if(btn.dataset.action==='clip'){showTab('clips');$('#clipVideo').value=j.id;}else if(btn.dataset.action==='copy'){await navigator.clipboard.writeText(j.filePath);notify('Caminho copiado.');}else if(btn.dataset.action==='source'){window.open(j.url,'_blank','noopener,noreferrer');}}catch(err){notify(err.message,true);}});
}
function patchRunningJob(job){
  const pct=Math.max(0,Math.min(100,Number(job.progress)||0));
  for(const row of document.querySelectorAll(`[data-job-id="${job.id}"]`)){
    const stage=row.querySelector('[data-job-stage]');
    const progress=row.querySelector('[data-job-progress]');
    const info=row.querySelector('[data-job-text]');
    if(stage)stage.textContent=job.stage||'Baixando';
    if(info)info.textContent=progressText(job);
    if(progress){if(['disco','iniciando'].includes(job.progressSource)&&pct===0)progress.removeAttribute('value');else progress.value=pct;}
  }
}
function events(){
 const src=new EventSource('/api/events');
 let lastPaint=0,pending=null;
 src.addEventListener('job',event=>{
   try {
     const job=JSON.parse(event.data);
     const index=state.jobs.findIndex(j=>j.id===job.id);
     const prev=index>=0?state.jobs[index]:null;
     if(index>=0)state.jobs[index]=job;else state.jobs.unshift(job);
     if(prev && prev.status===job.status && prev.title===job.title && job.status==='running')patchRunningJob(job);
     else {renderJobs();if(job.status==='completed'||job.status==='review') {renderLibrary();renderClips();}}
   }catch(e){console.error('Evento inválido',e);}
 });
 src.addEventListener('state',()=>refresh());
 src.addEventListener('tools',event=>{try{state.toolTask=JSON.parse(event.data);renderSettings();}catch{}});
 src.addEventListener('notice',event=>{try{notify(JSON.parse(event.data).error,true);}catch{}});
 src.onerror=()=>{};
}
bindEvents();bindSettings();await refresh();events();setInterval(refresh,5000);setInterval(()=>{for(const j of state.jobs||[])if(j.status==='running')patchRunningJob(j)},1000);
