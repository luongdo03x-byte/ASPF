import { rm, mkdir, cp, copyFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);const dist=new URL('../dist/',import.meta.url);
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
await copyFile(new URL('../manifest.json',import.meta.url),new URL('../dist/manifest.json',import.meta.url));
await cp(new URL('../src/',import.meta.url),dist,{recursive:true});
console.log('Built dist/');
