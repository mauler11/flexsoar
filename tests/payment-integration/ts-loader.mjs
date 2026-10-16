// Local test loader only. No env discovery, fetch, transpilation cache or package writes.
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
const root=new URL('../../',import.meta.url);
export async function resolve(specifier,context,next){
 let target;
 if(specifier.startsWith('@/'))target=new URL(specifier.slice(2),root);
 else if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:'))target=new URL(specifier,context.parentURL);
 if(target)for(const suffix of ['','.ts','.tsx']){const path=fileURLToPath(target)+suffix;if(/\.tsx?$/.test(path)&&existsSync(path))return {url:pathToFileURL(path).href,shortCircuit:true};}
 return next(specifier,context);
}
export async function load(url,context,next){
 if(/\.tsx?$/.test(url))return {format:'module',source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,shortCircuit:true};
 return next(url,context);
}
