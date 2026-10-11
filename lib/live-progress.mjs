import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Tracks the latest transfer counters. A download can have multiple video/audio
 * streams with different names, so bytes for each are stored independently.
 * The file-system fallback is labeled as disk I/O, not a verified network speed.
 */
export class LiveProgress {
  constructor() {
    this.streams = new Map();
    this.lastEventAt = 0;
    this.lastDiskAt = 0;
    this.lastDiskBytes = 0;
    this.hasNetworkData = false;
  }
  receive(p, now=Date.now()) {
    this.lastEventAt = now;
    const name = String(p.streamId || 'transfer');
    const prev = this.streams.get(name) || {downloadedBytes:0,totalBytes:0};
    const next = { ...prev };
    if(Number.isFinite(p.downloadedBytes)) next.downloadedBytes = Math.max(prev.downloadedBytes, p.downloadedBytes);
    if(Number.isFinite(p.totalBytes) && p.totalBytes>0) next.totalBytes = Math.max(prev.totalBytes, p.totalBytes);
    this.streams.set(name,next);
    const totals = this.totals();
    const data = {
      ...totals,
      progress: Number.isFinite(p.progress) ? Math.max(0,Math.min(100,p.progress)) : undefined,
      stage: p.stage || 'Baixando',
      speed: p.speed || '',
      eta: p.eta || '',
      progressSource:'yt-dlp',
      progressUpdatedAt: new Date(now).toISOString()
    };
    if(totals.downloadedBytes>0) this.hasNetworkData=true;
    return data;
  }
  totals() {
    let downloadedBytes=0,totalBytes=0;
    for(const {downloadedBytes:got,totalBytes:all} of this.streams.values()) {
      downloadedBytes+=got;
      totalBytes+=all;
    }
    return {downloadedBytes,totalBytes};
  }
  async sampleFiles(folder,prefix, now=Date.now()) {
    const entries=await fs.readdir(folder,{withFileTypes:true});
    let size=0;
    for(const e of entries) {
      if(!e.isFile() || !e.name.startsWith(prefix)) continue;
      if(/\.(ytdl|json|info\.json|description|jpg|png|webp|txt)$/i.test(e.name))continue;
      const stat=await fs.stat(path.join(folder,e.name)).catch(()=>null);
      if(stat?.size)size+=stat.size;
    }
    const elapsed=(now-this.lastDiskAt)/1000;
    const delta=size-this.lastDiskBytes;
    const diskRate=this.lastDiskAt>0 && elapsed>0.1 && delta>0 ? delta/elapsed : null;
    this.lastDiskBytes=size;
    this.lastDiskAt=now;
    return {bytes:size,bytesPerSec:diskRate};
  }
}
