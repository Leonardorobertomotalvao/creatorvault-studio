const {chromium}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cv-ui-'));
 const data=path.join(temp,'data'),downloads=path.join(temp,'downloads');fs.mkdirSync(data);fs.mkdirSync(downloads);
 const mock=path.join(temp,'tool');fs.writeFileSync(mock,'#!/usr/bin/env node\nconsole.log("mock tool 1.0")\n');fs.chmodSync(mock,0o755);
 const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
 fs.writeFileSync(path.join(data,'creatorvault.json'),JSON.stringify({settings:{downloadDir:downloads},projects:[],clips:[],jobs:ids.map((id,i)=>({id,title:i?'Transferência parcial':'Falha antes da transferência',url:'https://example.com/video'+i,mode:'1080',status:'failed',progress:i?40:0,error:'Falha de teste',downloadedBytes:i?400:0,totalBytes:1000}))}));
 process.env.CV_DATA_DIR=data;process.env.CV_DOWNLOAD_DIR=downloads;process.env.CV_YTDLP_PATH=mock;process.env.CV_FFMPEG_PATH=mock;
 const {createApp}=await import(require('node:url').pathToFileURL(path.resolve(__dirname,'../server.mjs')).href);
 const app=await createApp();let browser;
 const screenshots=path.resolve(process.env.CV_UI_ARTIFACT_DIR||temp);fs.mkdirSync(screenshots,{recursive:true});
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/content.security.policy|violates.*directive|refused.to/i.test(m.text()))errors.push(m.text())});
  await page.goto(app.url);await page.locator('#appVersion').filter({hasText:'1.6.0'}).waitFor();
  await page.getByRole('button',{name:'Downloads',exact:true}).click();
  const first=page.locator('#queue [data-job-id="'+ids[0]+'"] progress');const second=page.locator('#queue [data-job-id="'+ids[1]+'"] progress');
  assert.equal(await first.evaluate(e=>e.position),0);assert.equal(await second.evaluate(e=>e.position),0.4);
  assert.ok(await first.evaluate(e=>getComputedStyle(e).width!=='auto'));
  await page.screenshot({path:path.join(screenshots,'downloads.png'),fullPage:true});
  await page.getByRole('button',{name:'Configurações',exact:true}).click();await page.locator('#authMethod').selectOption('browser');
  assert.equal(await page.locator('#authBrowser').isVisible(),true);
  await page.locator('#authBrowser').selectOption('brave');await page.getByRole('button',{name:'Salvar autenticação',exact:true}).click();
  await page.getByText('Autenticação salva. Use Testar acesso antes de repetir a tarefa.').waitFor();
  await page.screenshot({path:path.join(screenshots,'settings.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('UI OK: barras 0%/40%, configurações salvas, nenhum erro JavaScript ou CSP');
 }finally{if(browser)await browser.close();await app.flush();await new Promise(r=>app.server.close(r));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
