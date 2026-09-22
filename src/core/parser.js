import { JOB_STATUS } from './constants.js';

const HEADER=/^##\s*\[(\d+)\/(\d+)\]\s+(S\d+_IMG\d+)\s+—\s+(.+)$/m;
const REFERENCE=/dùng\s+(S\d+_IMG\d+)\s+làm ảnh tham chiếu/i;
const RES=/tối thiểu\s+(\d+)px\s+chiều ngang,\s*tỷ lệ\s+([^\s]+)/i;

function clean(text){ return text.replace(/^\s+|\s+$/g,''); }
function filenameFor(id){ return `${id}.png`; }

export function parsePromptBatch(markdown) {
  const starts=[]; const re=/^##\s*\[\d+\/\d+\].*$/gm; let m;
  while ((m=re.exec(markdown))) starts.push(m.index);
  if (!starts.length) return [];
  const blocks=starts.map((start,i)=>markdown.slice(start, starts[i+1] ?? markdown.length).trim());
  return blocks.map(block=>{
    const h=block.match(HEADER); if(!h) throw new Error('Unsupported prompt block header');
    const [,index,total,id,meta]=h; const [sceneId,imageId]=id.split('_');
    const resolution=block.match(RES); const reference=(meta.match(REFERENCE)||block.match(REFERENCE))?.[1] ?? null;
    const body=block.slice(block.indexOf('\n')+1);
    const lines=body.split(/\r?\n/);
    const content=lines.filter(line=>!/^\*\*(Thao tác|Yêu cầu độ phân giải):/.test(line.trim())).join('\n').trim();
    const styleMarker='--- style lock ---'; const negMarker='--- negative ---';
    const stylePos=content.indexOf(styleMarker); const negPos=content.indexOf(negMarker);
    const mainPrompt=clean(stylePos>=0?content.slice(0,stylePos):content);
    const styleLock=stylePos>=0?clean(content.slice(stylePos+styleMarker.length, negPos>=0?negPos:undefined)):'';
    const negativePrompt=negPos>=0?clean(content.slice(negPos+negMarker.length)):'';
    const finalPrompt=[mainPrompt, styleLock?`${styleMarker}\n${styleLock}`:'', negativePrompt?`${negMarker}\n${negativePrompt}`:''].filter(Boolean).join('\n\n');
    return {index:Number(index),total:Number(total),id,sceneId,imageId,referenceId:reference,minWidth:resolution?Number(resolution[1]):null,aspectRatio:resolution?.[2]??'',mainPrompt,styleLock,negativePrompt,finalPrompt,filename:filenameFor(id),status:JOB_STATUS.PENDING,retryCount:0};
  });
}
