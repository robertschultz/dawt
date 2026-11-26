import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const dir=path.dirname(fileURLToPath(import.meta.url));
const abs=file=>path.join(dir,file);
const bundle=(entry,options)=>build({entryPoints:[abs(entry)],bundle:true,minify:true,legalComments:'inline',...options});
const [result,template,css,show,showTemplate,showStyle] = await Promise.all([
  bundle('dj.js',{write:false,platform:'browser',format:'iife'}),
  readFile(abs('dj.html'),'utf8'),readFile(abs('dj.css'),'utf8'),
  bundle('unreal.js',{write:false,platform:'browser',format:'iife'}),
  readFile(abs('shell.html'),'utf8'),readFile(abs('style.css'),'utf8'),
  bundle('server.cjs',{outfile:abs('../Signal.cjs'), platform:'node',format:'cjs',external:['bufferutil','utf-8-validate']})
]);
const fields={STYLE:css,SCRIPT:result.outputFiles[0].text};
await writeFile(abs('../dj.html'),template.replace(/\{\{([A-Z]+)\}\}/g,(_,key)=>fields[key]));
const gallery={
  ENGINE:'Unreal Engine',CSS:showStyle,SCRIPT:show.outputFiles[0].text,
  HINT:'Use the controls to cue a move.',DATA:'',FOOTER:'Live Unreal Engine render',
  STAGE:'<button id="stage" type="button">Change background <kbd>B</kbd></button>'
};
await writeFile(abs('../index.html'),showTemplate.replace(/\{\{([A-Z]+)\}\}/g,(_,key)=>gallery[key]));
