import {useEffect,useRef,useState,type ReactNode} from 'react'
import {newId} from './core/newId'
import type {DataAdapter,ImportMode,OnArchiveChange,PhotoMetadata} from './api/adapter'
import {PaperPills,PanelSwap} from './PaperControls'
import {PaperDialog} from './PaperDialog'
import {PaperDatePicker,PaperMonthPicker} from './PaperFields'
import {useResource} from './workspace'

const destinations=[['single','独立散照'],['new','新建照片集'],['existing','已有照片集']] as const
const precisions=[['unknown','未注明'],['year','年'],['month','年月'],['exact','年月日']] as const
const limits='每次可选 1–12 张 JPG、PNG 或 WebP，每张至多 12 MiB，合计至多 24 MiB。'
export type ImportProps={api:DataAdapter;changed:OnArchiveChange;notify:(message:string)=>void}

function Thumbnail({file}:{file:File}){
  const ref=useRef<HTMLImageElement>(null)
  useEffect(()=>{
    const img=ref.current
    if(!img)return
    const url=URL.createObjectURL(file)
    img.src=url
    return ()=>{img.removeAttribute('src');URL.revokeObjectURL(url)}
  },[file])
  return <img ref={ref} alt={file.name} decoding="async"/>
}

type ImportReceipt = {setId:string|null; message:string}
function ImportForm({api,changed,complete,busy,setBusy}:Pick<ImportProps,'api'|'changed'> & {
  complete:(result:ImportReceipt)=>void;busy:boolean;setBusy:(v:boolean)=>void
}){
  const [files,setFiles]=useState<File[]>([]),[mode,setMode]=useState<ImportMode>('single')
  const [precision,setPrecision]=useState('unknown'),[setId,setSetId]=useState('')
  const [error,setError]=useState(''),[over,setOver]=useState(false)
  const input=useRef<HTMLInputElement>(null),pending=useRef(false),receipt=useRef('')
  const sets=useResource(()=>api.albums(),[])
  function modified(){receipt.current='';setError('')}
  function choose(list:FileList|null){
    if(!list?.length||pending.current)return
    const next=Array.from(list)
    modified()
    if(next.length>12||next.some(f=>!f.size||f.size>12*1024*1024||!/[.](jpe?g|png|webp)$/i.test(f.name))
        ||next.reduce((n,f)=>n+f.size,0)>24*1024*1024){
      setFiles([]);setError(limits);return
    }
    setFiles(next);setMode(next.length===1?'single':'new')
  }
  async function submit(form:HTMLFormElement) {
    if(pending.current)return
    if(!files.length){setError('请先点选或拖入图片。');return}
    if(mode==='existing'&&!setId){setError('请选择要编入的照片集。');return}
    const data=new FormData(form)
    receipt.current ||= newId()
    const metadata:PhotoMetadata={key:receipt.current,mode,precision}
    for(const key of ['title','note','date'] as const){const v=data.get(key);if(typeof v==='string' && v.trim())metadata[key]=v.trim()}
    if(mode==='existing')metadata.set_id=setId
    pending.current=true;setBusy(true);setError('')
    try {
      const result=await api.importPhotos(files,metadata)
      changed(result.photo_ids[0])
      complete({setId:result.set_id,message:'已导入 '+result.photo_ids.length+' 张照片 · '+(result.set_id?'照片集 '+result.set_id:'独立散照')+' · '+result.photo_ids.join('、')})
    } catch {setError('未能导入。请检查图片格式、大小和所选照片集后重试。')}
    finally{pending.current=false;setBusy(false)}
  }
  return <form onChangeCapture={modified} onSubmit={e=>{e.preventDefault();void submit(e.currentTarget)}}>
    <fieldset className="import-fields" disabled={busy}>
      <input ref={input} hidden tabIndex={-1} aria-label="本机图片文件" type="file" multiple accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        onChange={e=>{choose(e.currentTarget.files);e.currentTarget.value=''}}/>
      <button className="drop-zone" type="button" aria-label="选择本机图片" data-over={over || undefined} onClick={()=>input.current?.click()}
        onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';if(!over)setOver(true)}}
        onDragLeave={e=>{if(!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget))setOver(false)}}
        onDrop={e=>{e.preventDefault();setOver(false);choose(e.dataTransfer.files)}}>
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.5"/><path d="m4 17 5-5 4 3 3-4 4.5 5"/></svg>
        <span>{files.length?'重新选图，或拖入替换':'点选或拖入照片'}</span><small>JPG · PNG · WebP</small>
      </button>
      {files.length>0 && <div className="file-previews">{files.map((f,i)=><Thumbnail key={i} file={f}/>)}</div>}
      <small className="file-count" role="status">{files.length?'已选 '+files.length+' 张照片':'每张至多 12 MiB，可同时选择 12 张，合计至多 24 MiB。'}</small>
      <PaperPills label="收录位置" options={destinations} value={mode} change={setMode}/>
      <PanelSwap identity={mode}>{mode==='new' && <label>组名（可选）<input name="title" maxLength={2000}/></label>}
      {mode==='existing' && <div className="set-choices"><PaperPills label="目标照片集" options={(sets.value??[]).map(a=>[a.set_id,a.title_raw||a.set_id] as const)} value={setId} change={setSetId}/>
        {sets.value?.length===0 && <small>当前尚无照片集。</small>}{sets.error}</div>}
      </PanelSwap><PaperPills label="日期精度" options={precisions} value={precision} change={setPrecision}/>
      <PanelSwap identity={precision}>{precision==='exact'?<PaperDatePicker required name="date" label="照片日期"/>:precision==='month'?<PaperMonthPicker required name="date" label="照片日期"/>:precision==='year' && <label>照片日期<input key={precision} name="date" required type="text"
        pattern={precision==='year'?'[0-9]{4}':undefined} placeholder={precision==='year'?'YYYY':undefined}/></label>}
      </PanelSwap><label>说明（可选）<input name="note" maxLength={2000}/></label>
      <button type="submit">{busy?'正在导入…':'确认导入'}</button>
    </fieldset>{error && <p role="status">{error}</p>}
  </form>
}

export function PhotoImport({toolbar,selectDestination,...props}:ImportProps & {
  toolbar:(toggle:ReactNode)=>ReactNode;selectDestination:(setId:string|null)=>void
}){
  const [open,setOpen]=useState(false),[mounted,setMounted]=useState(false),[busy,setBusy]=useState(false)
  const imported=useRef<ImportReceipt|null>(null)
  function dismiss(){if(!busy)setOpen(false)}
  return <>{toolbar(<button className="import-toggle" type="button" aria-haspopup="dialog"
    onClick={()=>{setMounted(true);setOpen(true)}}>导入照片</button>)}
    {mounted && <PaperDialog open={open} title="导入照片" className="settings-panel import-dialog" busy={busy}
      onDismiss={dismiss} onClosed={()=>{
        setMounted(false)
        if(imported.current){
          selectDestination(imported.current.setId);props.notify(imported.current.message);imported.current=null
        }
      }}>
      <div className="dialog-heading"><h2>导入照片</h2><button type="button" aria-label="关闭导入照片" onClick={dismiss} disabled={busy}>×</button></div>
      <div className="photo-import"><ImportForm api={props.api} changed={props.changed} busy={busy || !open} setBusy={setBusy}
        complete={result=>{imported.current=result;setOpen(false)}}/></div>
    </PaperDialog>}
  </>
}
