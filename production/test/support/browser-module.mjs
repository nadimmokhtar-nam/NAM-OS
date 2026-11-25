import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Execute the real dependency graph in the test's DOM boundary. Each module
// keeps its own lexical scope; no factory is replaced with a passing stub.
export async function loadBrowserModule(context,file,loaded=new Map()){
 if(loaded.has(file))return loaded.get(file);
 let source=await readFile(new URL('../../public/'+file,import.meta.url),'utf8');
 const imports={},bindings=[];
 for(const match of source.matchAll(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)['"];?\s*$/gm)){
  imports[match[2]]=await loadBrowserModule(context,match[2],loaded);
  bindings.push(`const {${match[1]}}=imports[${JSON.stringify(match[2])}];`);
 }
 const exports=Array.from(source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm),match=>match[1]);
 source=source.replace(/^import[^\n]*\n/gm,'').replace(/^export\s+/gm,'');
 const factory=vm.runInContext(`(function(imports){${bindings.join('\n')}\n${source}\nreturn {${exports.join(',')}};})`,context,{filename:file});
 const module=factory(imports);loaded.set(file,module);return module;
}
