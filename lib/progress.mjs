/** yt-dlp progress parser. Never infer 0 from an absent/NA field. */
export function asNumber(raw) {
  if (raw == null) return null;
  const txt = String(raw).trim();
  if (!txt || /^(NA|none|unknown|null|nan|undefined|N\/A)$/i.test(txt)) return null;
  const normalized = txt.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s/g, '').replace('%', '').replace(',', '.');
  return /^-?\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : null;
}
export function parseYtDlpLine(raw) {
  const line = String(raw).replace(/\x1b\[[0-9;]*m/g, '').replace(/^\uFEFF/, '').trim();
  // Covers log prefixes/CR sequences on Windows, not just startsWith.
  const finalIndex = line.indexOf('CV_FINAL:');
  if (finalIndex >= 0) return {kind:'final', filePath:line.slice(finalIndex + 9).trim().replace(/^['"]|['"]$/g, '')};
  const idx = line.indexOf('CV_PROGRESS:');
  if (idx >= 0) {
    const [pctRaw, downloadedRaw, totalRaw, estimateRaw, speedRaw, etaRaw, statusRaw, ...filenameParts] = line.slice(idx + 12).split('|');
    const downloaded = asNumber(downloadedRaw);
    const total = asNumber(totalRaw) ?? asNumber(estimateRaw);
    const reported = asNumber(pctRaw);
    const ratio = total != null && total > 0 && downloaded != null ? (downloaded / total) * 100 : null;
    // Use the actual bytes for current transfer whenever possible.
    const percent = ratio ?? reported;
    const done = (statusRaw || '').toLowerCase().includes('finished');
    const speed = typeof speedRaw==='string' && !/^(NA|none|unknown)$/i.test(speedRaw.trim()) ? speedRaw.trim() : '';
    const streamId = filenameParts.join('|').trim();
    const eta = typeof etaRaw==='string' && !/^(NA|none|unknown)$/i.test(etaRaw.trim()) ? etaRaw.trim() : '';
    return {kind:'progress', progress:percent==null?null:Math.min(100,Math.max(0,percent)), downloadedBytes:downloaded, totalBytes:total, speed, eta, streamId:streamId&&streamId!=='NA'?streamId:'transfer', stage:done?'Finalizando arquivo':'Baixando'};
  }
  const classic = line.match(/\[download\]\s*([\d.,]+)%\s+of\s+(?:~?)([\d.,]+)(KiB|MiB|GiB|TiB)/i);
  if (classic) {
    const pct=asNumber(classic[1]);
    const sizes={KIB:1024,MIB:1024**2,GIB:1024**3,TIB:1024**4};
    const total=asNumber(classic[2])*(sizes[classic[3].toUpperCase()]||1);
    return {kind:'progress',progress:pct,totalBytes:total,downloadedBytes:total*pct/100,stage:'Baixando',speed:'',eta:''};
  }
  const simple = line.match(/\[download\]\s*([\d.,]+)%/);
  if (simple) return {kind:'progress',progress:asNumber(simple[1]),stage:'Baixando'};
  if (/\b(merging formats|fixup|remuxing|moving file|post-process|postprocess|extracting audio)\b/i.test(line))
    return {kind:'stage',stage:/extracting audio/i.test(line)?'Convertendo áudio':'Processando mídia'};
  if (/^ERROR:/i.test(line)) return {kind:'error',detail:line.slice(0,600)};
  return {kind:'other'};
}
export function percentFromProgress(progress, fallback=0) {
  const n=asNumber(progress);
  return n==null?fallback:Math.round(Math.max(0, Math.min(100,n))*10)/10;
}
