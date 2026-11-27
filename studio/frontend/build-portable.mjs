import {execFileSync} from 'node:child_process'
import {createHash, randomUUID} from 'node:crypto'
import {lstat, mkdir, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'vite'

const frontend = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(frontend, '../..')
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--out' || !args[1].trim() || args[1].startsWith('--'))) {
  throw Error('Usage: npm run build:portable-demo -- [--out FILE]')
}
const target = path.resolve(root, args[1] || process.env.LA_PORTABLE_OUT || 'portable_demo/life-archive-demo-v1.1.0.html')
const output = path.dirname(target)
async function inspect(file) {
  try {
    const info = await lstat(file)
    if (info.isSymbolicLink() || (await realpath(file)).toLowerCase() !== file.toLowerCase()) {
      throw Error('Linked output path')
    }
    return info
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}
const parents = [output]
while (path.dirname(parents.at(-1)) !== parents.at(-1)) parents.push(path.dirname(parents.at(-1)))
for (const parent of parents.reverse()) {
  const info = await inspect(parent)
  if (!info) await mkdir(parent)
  else if (!info.isDirectory()) throw Error('Expected an output directory')
}
async function inspectTarget() {
  const existing = await inspect(target)
  if (existing && (!existing.isFile() || existing.nlink !== 1)) throw Error('Expected an unlinked output file')
}
await inspectTarget()
const environmentPython = process.env.LA_PYTHON?.trim()
const venv = path.join(root, 'studio/backend/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const python = environmentPython || await lstat(venv).then(() => venv, err => {
  if (err.code !== 'ENOENT') throw err
  return process.platform === 'win32' ? 'python' : 'python3'
})
const seed = execFileSync(python, ['-E','-B','-X','utf8','-m','studio.backend.export_portable_seed'],
  {cwd:root, encoding:'utf8', maxBuffer:32*1024*1024})
JSON.parse(seed)
const version = createHash('sha256').update(seed).digest('hex').slice(0,16)
const result = await build({root:frontend, define:{
  'import.meta.env.VITE_PORTABLE_DEMO':JSON.stringify('1'), 'process.env.NODE_ENV':JSON.stringify('production')
}, build:{write:false, sourcemap:false, copyPublicDir:false, lib:{entry:path.join(frontend,'src/main.tsx'),name:'LifeArchive',formats:['iife']}}})
const files = [result].flat().flatMap(r=>r.output)
const js = files.filter(f=>f.type==='chunk'), css = files.filter(f=>f.fileName.endsWith('.css'))
if(js.length!==1 || css.length!==1 || files.length!==2) throw Error('Expected one script and one stylesheet')
const template = await readFile(path.join(frontend,'index.html'),'utf8')
const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"
const html = template.replace('<head>',()=>'<head><meta http-equiv="Content-Security-Policy" content="'+csp+'">')
  .replace('</head>',()=>'<style>'+String(css[0].source).replace(/<\/style/gi,'<\\/style')+'</style></head>')
  .replace('<script type="module" src="./src/main.tsx"></script>',()=>
    '<script type="application/json" id="portable-seed" data-version="'+version+'">'+seed.replace(/</g,'\\u003c')+'</script>\n<script>'+
    js[0].code.replace(/<\/script/gi,'<\\/script')+'</script>')
if(!html.includes('id="portable-seed"') || /<script\b[^>]*\bsrc\s*=/i.test(html)) throw Error('Template mismatch')
const temp = path.join(output, randomUUID() + '.tmp')
try {
  await writeFile(temp, html, {flag:'wx'})
  await inspectTarget()
  await rename(temp, target)
} finally { await rm(temp, {force:true}) }
console.log(path.basename(target),Buffer.byteLength(html),'bytes')
