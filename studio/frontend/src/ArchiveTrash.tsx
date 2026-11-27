import {AnimatePresence,motion} from 'framer-motion'
import {PaperDialog} from './PaperDialog'
import {enterPaper,exitPaper} from './motion/motionTokens'
import {useReducedMotionPreference} from './entrances/scheme-a/paperMotion'
import {createContext,useContext,useRef,useState,type ReactNode} from 'react'
import type {ArchiveItem,ArchiveOperation,BinItem,DataAdapter} from './api/adapter'
import {useResource} from './workspace'

const names={entry:'日记',photo:'照片',photo_set:'照片集'}
const title=(item:ArchiveItem)=>item.title && item.title!==item.id?item.title+' · '+item.id:item.id
type Confirmation=({action:'move';item:ArchiveItem}|{action:'purge';item:BinItem}) & {done?:()=>void}
const Ask=createContext<((request:Confirmation)=>void)|null>(null)

export function TrashControls({api,enabled,changed,notify,children}:{api:DataAdapter;enabled:boolean;changed:(op:ArchiveOperation)=>void;notify:(s:string)=>void;children:ReactNode}){
  const [request,ask]=useState<Confirmation|null>(null)
  return <Ask.Provider value={enabled?ask:null}>{children}
    {enabled && request && <ConfirmArchive request={request} cancel={()=>ask(null)} commit={async()=>{
      try{await api.changeArchive(request)}
      catch(error){if(request.action==='purge')changed(request);throw error}
      request.done?.();changed(request)
      notify((request.action==='move'?'已移入暂存箱':'已彻底清除')+' · '+title(request.item))
    }}/>}
  </Ask.Provider>
}

function ConfirmArchive({request,cancel,commit}:{request:Confirmation;cancel:()=>void;commit:()=>Promise<void>}){
  const move=request.action==='move'
  const heading=(move?'移出档案':'彻底清除')+'这'+(request.item.kind==='photo'?'张照片':request.item.kind==='entry'?'篇日记':'个照片集')+'？'
  return <ActionConfirm title={heading} label={move?'确认移入暂存箱':'确认彻底清除'} commit={commit} close={cancel}>
    <p className="archive-item-name">{title(request.item)}</p>
    <p>{move?'记录将移入暂存箱，可在设置中恢复。':'清除后无法恢复。'}
      {request.item.kind==='photo_set'?'组内照片各自保留。':request.item.kind==='entry'?'关联照片与独立的历史回应保留。':move?'隔离副本会保留。':'仅在最后一条引用清除时删除归档时建立的隔离副本。'}电脑中的原件始终保留。</p>
  </ActionConfirm>
}

export function ActionConfirm({title,label,children,commit,close}:{title:string;label:string;children:ReactNode;commit:()=>Promise<void>;close:()=>void}){
  const pending=useRef(false),[open,setOpen]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('')
  async function submit(){
    if(pending.current)return
    pending.current=true;setBusy(true);setError('')
    try{await commit();setOpen(false)}
    catch{setError('操作未完成，请核对记录后重试。');pending.current=false;setBusy(false)}
  }
  return <PaperDialog open={open} title={title} className="archive-confirm" busy={busy} onDismiss={()=>setOpen(false)} onClosed={close}>
    <h2>{title}</h2>{children}<div className="archive-choices"><button type="button" autoFocus disabled={busy} onClick={()=>setOpen(false)}>取消</button>
      <button type="button" disabled={busy} onClick={submit}>{label}</button></div>{error && <p role="status">{error}</p>}
  </PaperDialog>
}

export function MoveOut({item,done,label='移出档案'}:{item:ArchiveItem;done?:()=>void;label?:string}){
  const ask=useContext(Ask)
  return ask && <button type="button" className="move-out" aria-label={label+' · '+item.id} onClick={()=>ask({action:'move',item,done})}>{label}</button>
}

export function BinList({api,changed,notify}:{api:DataAdapter;changed:(op:ArchiveOperation)=>void;notify:(s:string)=>void}){
  const reduced=useReducedMotionPreference()
  const list=useResource(()=>api.trash(),[]),ask=useContext(Ask),pending=useRef(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const [batch,setBatch]=useState<{action:'restore'|'purge';items:BinItem[]}>()
  const protectedHistory=list.value?.some(item=>item.protected_history)
  async function applyAll(){
    if(!batch)return
    if(batch.action==='restore'){
      const result=await api.restoreAll()
      for(const item of batch.items)if(!item.purging)changed({action:'restore',item})
      notify('已恢复 '+result.restored+' 项'+(result.skipped?' · 跳过 '+result.skipped+' 项清理中的照片':''))
    }else{
      try{const result=await api.purgeAll();notify('已彻底清除 '+result.purged+' 项')}
      finally{for(const item of batch.items)changed({action:'purge',item})}
    }
  }
  async function restore(item:BinItem){
    if(pending.current)return
    pending.current=true;setBusy(true);setError('')
    try{const op:ArchiveOperation={action:'restore',item};await api.changeArchive(op);changed(op);notify('已恢复'+names[item.kind]+' · '+title(item))}
    catch{setError('未能恢复，请重新查看暂存箱。')}
    finally{pending.current=false;setBusy(false)}
  }
  return <div className="bin-list">{list.error}{error && <p role="status">{error}</p>}
    {!!list.value?.length && <div className="bin-bulk"><span>共 {list.value.length} 项</span>
      <button onClick={()=>setBatch({action:'restore',items:list.value!})}>恢复全部</button>
      <button disabled={protectedHistory} onClick={()=>setBatch({action:'purge',items:list.value!})}>清空暂存箱</button></div>}
    {protectedHistory && <p>暂存箱中有历史原段。请先恢复对应日记，再清空其余记录。</p>}
    {batch && <ActionConfirm title={batch.action==='restore'?'恢复全部记录？':'清空暂存箱？'} label={batch.action==='restore'?'确认恢复全部':'确认清空'}
      commit={applyAll} close={()=>setBatch(undefined)}><p>{batch.action==='restore'?'恢复暂存箱内可恢复的记录。':
      '将彻底清除暂存箱内全部 '+batch.items.length+' 项记录，清除后无法恢复。电脑中的原件始终保留。'}</p></ActionConfirm>}
    {list.value?.length===0 && <p>暂存箱是空的。</p>}
    <AnimatePresence initial={false} mode="popLayout">{list.value?.map(item=><motion.article layout={reduced?false:"position"} transition={reduced?{duration:0}:enterPaper} exit={{opacity:0,transition:reduced?{duration:0}:exitPaper}} key={item.kind+item.id} data-bin-id={item.id}><div><strong>{names[item.kind]} · {title(item)}</strong>
      <time dateTime={item.deleted_at}>{new Date(item.deleted_at).toLocaleString('zh-CN',{hour12:false})} 移出</time></div>
      <div className="bin-actions"><button type="button" disabled={busy || !!item.purging} onClick={()=>restore(item)}>恢复</button>
      <button type="button" disabled={busy||!!item.protected_history} onClick={()=>ask?.({action:'purge',item})}>{item.purging?'继续彻底清除':'彻底清除'}</button></div></motion.article>)}</AnimatePresence>
  </div>
}
