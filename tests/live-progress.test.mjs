import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LiveProgress} from '../lib/live-progress.mjs';
import {parseYtDlpLine} from '../lib/progress.mjs';

test('progresso de áudio e vídeo soma os bytes de cada fluxo sem reiniciar a contagem',()=>{
  const meter=new LiveProgress();
  const first=parseYtDlpLine('CV_PROGRESS:50.0%|5242880|10485760|NA|5.0MiB/s|00:01|downloading|C:\\Downloads\\video.f137.mp4.part');
  assert.equal(first.streamId,'C:\\Downloads\\video.f137.mp4.part');
  const a=meter.receive(first,1000);
  assert.equal(a.downloadedBytes,5242880);
  assert.equal(a.totalBytes,10485760);
  meter.receive({...first,progress:100,downloadedBytes:10485760},1100);
  const second=parseYtDlpLine('CV_PROGRESS:25.0%|524288|2097152|NA|1.0MiB/s|00:02|downloading|C:\\Downloads\\audio.f140.m4a.part');
  const b=meter.receive(second,1500);
  assert.equal(b.downloadedBytes,11010048);
  assert.equal(b.totalBytes,12582912);
  assert.equal(b.progress,25);
  assert.equal(b.progressSource,'yt-dlp');
  assert.equal(b.eta,'00:02');
  const again=meter.receive({...second,downloadedBytes:262144},1550);
  assert.equal(again.downloadedBytes,b.downloadedBytes,'não deve contar bytes regressivos');
});

test('amostragem do arquivo .part detecta transferência sem eventos de progresso',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cv15live-'));
  const meter=new LiveProgress();
  try {
    const file=path.join(folder,'CV-AAA-video.mp4.part');
    await fs.writeFile(file,Buffer.alloc(1024*1024));
    const a=await meter.sampleFiles(folder,'CV-AAA-',1000);
    assert.equal(a.bytes,1024*1024);
    await fs.writeFile(file,Buffer.alloc(2*1024*1024));
    const b=await meter.sampleFiles(folder,'CV-AAA-',2000);
    assert.equal(b.bytes,2*1024*1024);
    assert.equal(b.bytesPerSec,1024*1024);
    await fs.writeFile(path.join(folder,'CV-AAA-meta.info.json'),'{}');
    const c=await meter.sampleFiles(folder,'CV-AAA-',3000);
    assert.equal(c.bytes,2*1024*1024);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});
