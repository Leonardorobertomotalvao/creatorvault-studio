import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {asNumber,parseYtDlpLine} from '../lib/progress.mjs';
import {findFinishedMedia,jobTag} from '../lib/finalize.mjs';

test('progresso em MB, bytes e ETA, com campos NA',()=>{
  let p=parseYtDlpLine('CV_PROGRESS: 50.0%|5242880|10485760|NA|4.2MiB/s|00:01|downloading');
  assert.equal(p.kind,'progress');assert.equal(p.progress,50);assert.equal(p.downloadedBytes,5242880);
  assert.equal(p.totalBytes,10485760);assert.equal(p.speed,'4.2MiB/s');assert.equal(p.eta,'00:01');
  p=parseYtDlpLine('CV_PROGRESS:12.5%|1250|NA|10000|NA|NA|downloading');
  assert.equal(p.totalBytes,10000);assert.equal(p.progress,12.5);assert.equal(p.speed,'');
  assert.equal(asNumber('NA'),null);assert.equal(asNumber(''),null);
  p=parseYtDlpLine('CV_PROGRESS:99.9%|NA|NA|NA|NA|NA|finished');
  assert.equal(p.progress,99.9);assert.equal(p.totalBytes,null);assert.equal(p.stage,'Finalizando arquivo');
});
test('final de arquivo é detectado mesmo com prefixos na linha',()=>{
  assert.deepEqual(parseYtDlpLine('INFO: CV_FINAL:E:\\Vídeos\\Teste.mp4'),{kind:'final',filePath:'E:\\Vídeos\\Teste.mp4'});
  assert.equal(parseYtDlpLine('CV_FINAL:/home/test/A.mp4').filePath,'/home/test/A.mp4');
});
test('progresso tradicional ainda pode ser lido',()=>{
  assert.equal(parseYtDlpLine('[download]  34.4% of 10.00MiB at 1.1MiB/s').progress,34.4);
});
test('verificação acha mídia por ID e ignora arquivos .part e fluxos intermediários',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cv14-file-'));
  try{
    const tag=jobTag('b9e011ac-a0aa-470b-aa00-100000000002');
    await fs.writeFile(path.join(folder,tag+'fragment.f137.mp4'),'foo');
    await fs.writeFile(path.join(folder,tag+'mídia.part'),'foo');
    let found=await findFinishedMedia({folder,jobTag:tag,reportedPaths:[]});assert.equal(found,null);
    const final=path.join(folder,tag+'Mídia é teste [720].mp4');
    await fs.writeFile(final,'conteudo completo');
    found=await findFinishedMedia({folder,jobTag:tag,reportedPaths:[path.join(folder,'inexistente.mp4')]});
    assert.equal(found.filePath,final);assert.equal(found.source,'disk');
    assert.equal(found.sizeBytes,Buffer.byteLength('conteudo completo'));
    // Do not accidentally classify another job's output.
    found=await findFinishedMedia({folder,jobTag:jobTag('00000000-0000-0000-0000-000000000000'),reportedPaths:[final]});
    assert.equal(found,null);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});
