export async function readPromptFile(file){
  if(!file) throw new Error('No prompt file selected.');
  const name=String(file.name||'');
  if(!/\.md$/i.test(name)) throw new Error('Prompt file must be a .md file.');
  const markdown=await file.text();
  if(!markdown.trim()) throw new Error('Prompt file is empty.');
  return {filename:name,markdown};
}
