import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {DEFAULT_CONFIG} from './src/community.mjs';
const root=dirname(fileURLToPath(import.meta.url));
export async function buildSafePage({outdir=join(root,'dist'),packagedDir=join(root,'packaged'),rpcUrl=DEFAULT_CONFIG.rpcUrl,arkivChainId=DEFAULT_CONFIG.arkivChainId,watchers=DEFAULT_CONFIG.watchers}={}){
 let url;try{url=new URL(rpcUrl);}catch{throw Error('Invalid public RPC URL');}if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))||url.username||url.password||url.search||url.hash||!Number.isSafeInteger(arkivChainId)||arkivChainId<1||!Array.isArray(watchers)||!watchers.length||watchers.some(x=>typeof x!=='string'||!/^0x[0-9a-f]{40}$/.test(x))||new Set(watchers).size!==watchers.length)throw Error('Invalid safe build configuration');
 const config={rpcUrl,arkivChainId,watchers};const result=await build({entryPoints:[join(root,'src/app.mjs')],bundle:true,write:false,platform:'browser',format:'iife',target:'es2020',define:{__SAFE_CONFIG__:JSON.stringify(config)}});
 const html=await readFile(join(root,'src/index.html'),'utf8'),css=await readFile(join(root,'src/style.css'));const csp=`default-src 'none'; script-src 'self'; style-src 'self'; connect-src ${url.origin}; base-uri 'none'; form-action 'none'; object-src 'none'`;const remote=html.replace('__CSP__',csp);const packaged=remote.replace('./app.js','./safe.js').replace('./style.css','./safe.css');await mkdir(outdir,{recursive:true});await mkdir(packagedDir,{recursive:true});await Promise.all([writeFile(join(outdir,'index.html'),remote),writeFile(join(outdir,'app.js'),result.outputFiles[0].contents),writeFile(join(outdir,'style.css'),css),writeFile(join(packagedDir,'safe.html'),packaged),writeFile(join(packagedDir,'safe.js'),result.outputFiles[0].contents),writeFile(join(packagedDir,'safe.css'),css)]);return {remote:{html:join(outdir,'index.html'),script:join(outdir,'app.js'),style:join(outdir,'style.css')},packaged:{html:join(packagedDir,'safe.html'),script:join(packagedDir,'safe.js'),style:join(packagedDir,'safe.css')}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildSafePage();
