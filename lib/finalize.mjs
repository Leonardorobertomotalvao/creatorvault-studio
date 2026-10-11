import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const OUTPUT_EXT=new Set(['.mp4','.mkv','.webm','.mov','.m4a','.mp3','.opus','.ogg','.wav','.flac']);
function isPartial(name) {
  return /\.(part|partial|temp|tmp|ytdl)$/i.test(name) || /\.f\d+\./i.test(name);
}
function candidateInfo(p, folder, jobTag) {
  if (typeof p !== 'string' || !p.trim()) return null;
  const absolute=path.resolve(p.trim().replace(/^['"]|['"]$/g,''));
  const parent=path.resolve(folder);
  if (path.dirname(absolute)!==parent) return null;
  if (!path.basename(absolute).startsWith(jobTag)) return null;
  if (isPartial(absolute) || !OUTPUT_EXT.has(path.extname(absolute).toLowerCase())) return null;
  try {
    const stats=fs.statSync(absolute);
    if(!stats.isFile() || stats.size<=0) return null;
    return {filePath:absolute,sizeBytes:stats.size,modifiedAt:stats.mtimeMs};
  } catch {return null;}
}
/** Prefer after_move file, fall back to job-tagged completed media in the folder. */
export async function findFinishedMedia({folder,jobTag,reportedPaths=[]}) {
  for(const p of reportedPaths){
    const exact=candidateInfo(p,folder,jobTag);
    if(exact) return {...exact,source:'yt-dlp'};
  }
  const names=await fsp.readdir(folder).catch(()=>[]);
  const matches=names.filter(n=>n.startsWith(jobTag) && !isPartial(n) && OUTPUT_EXT.has(path.extname(n).toLowerCase()))
    .map(n=>candidateInfo(path.join(folder,n),folder,jobTag)).filter(Boolean)
    .sort((a,b)=>b.modifiedAt-a.modifiedAt);
  return matches[0] ? {...matches[0],source:'disk'} : null;
}
export function jobTag(id){return `CV-${String(id).replace(/[^a-f0-9-]/gi,'').slice(0,14)}-`;}
