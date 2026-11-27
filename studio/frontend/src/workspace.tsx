import {createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react'
import type {DataAdapter} from './api/adapter'
import type {Page} from './core/navigation'

import {PaperSelect} from './PaperFields'
import {AnimatePresence,motion,useIsPresent} from 'framer-motion'
import {enterPaper,exitPaper,paperCurve} from './motion/motionTokens'
import {useReducedMotionPreference} from './entrances/scheme-a/paperMotion'

export function RouteLayer({children}:{children:ReactNode}){
  const present=useIsPresent(),reduced=useReducedMotionPreference()
  return <motion.div className="route-layer" data-leaving={!present || undefined} inert={!present} aria-hidden={!present}
    initial={reduced?false:{opacity:0}} animate={{opacity:1}} transition={reduced?{duration:0}:enterPaper}
    exit={{opacity:0,transition:reduced?{duration:0}:exitPaper}}>{children}</motion.div>
}
export const ArchiveRevision=createContext(0)

export function useResource<T>(load:()=>Promise<T>, deps:readonly unknown[]) {
  const [retry,setRetry]=useState(0)
  const [result,setResult]=useState<{key:string; base:string; value?:T; failed?:boolean}>()
  const base=JSON.stringify(deps), revision=useContext(ArchiveRevision)
  const key=JSON.stringify([base,retry,revision])
  useEffect(()=>{
    let active=true
    load().then(value=>{if(active)setResult({key,base,value})},()=>{if(active)setResult({key,base,failed:true})})
    return ()=>{active=false}
  },[key])
  return {value:result?.base===base?result.value:undefined, lastValue:result?.value, pending:result?.key!==key,
    error:result?.key===key && result.failed ? <button onClick={()=>setRetry(n=>n+1)}>读取失败，重试</button>:null}
}

export function Sheet({title,children}:{title:string; children:ReactNode}) {
  return <main className="work-sheet"><div className="work-column"><h1>{title}</h1>{children}</div></main>
}

function monthOf(date?:string){
  const m=date?.match(/(\d{4})\D+(\d{1,2})/)
  return m?m[1]+'-'+m[2].padStart(2,'0'):'日期未详'
}
export function Lookup({api,query,setQuery,month,setMonth,read,readOrphan}:{api:DataAdapter;query:string;setQuery:(s:string)=>void;
  month:string;setMonth:(s:string)=>void;readOrphan:(id:string)=>void;read:(id:string,para?:string)=>void}) {
  const orphans=useResource(()=>api.orphans(),[])
  const list=useResource(()=>api.entries(),[])
  const hits=useResource(()=>query?api.search(query):Promise.resolve([]),[query])
  const entries=list.value??[]
  const months=[...new Set(entries.map(e=>monthOf(e.entry_date)))].sort().reverse()
  return <Sheet title="查阅"><div className="work-fields"><label>原文字句<span className="lookup-input"><input autoFocus autoComplete="off" spellCheck={false} type="search" value={query} onChange={e=>setQuery(e.target.value)}/></span></label>
    <PaperSelect label="年月" value={month} change={setMonth} options={[['','全部年月'],...months.map(m=>[m,m] as const)]}/></div>
    {list.error || hits.error}
    {list.value?.length===0 && <p>档案里还没有手稿，可前往「整理 → 收日记」写下第一篇。</p>}
    {months.filter(m=>!month||month===m).map(m=>{
      const rows=entries.filter(e=>monthOf(e.entry_date)===m && (!query||hits.value?.some(h=>h.entry_id===e.entry_id)))
      return rows.length>0 && <section key={m}><h2>{m}</h2>{rows.map(e=><article className="work-row" key={e.entry_id}>
        <small>{e.entry_date} · {e.entry_id}</small><button onClick={()=>read(e.entry_id)}>{e.title_raw}</button>
        {e.written_time_raw && <small>{e.written_time_raw}</small>}{e.backfill_note && <small>补录 · {e.backfill_note}</small>}
        {query && hits.value?.filter(h=>h.entry_id===e.entry_id).map(h=><button className="hit" key={h.para_id} onClick={()=>read(e.entry_id,h.para_id)}>第 {h.seq_no} 段　{h.text_raw}</button>)}
      </article>)}</section>
    })}
    {entries.length>0 && query && hits.value && !hits.value.some(h=>!month||entries.some(e=>e.entry_id===h.entry_id&&monthOf(e.entry_date)===month)) && <p>没有找到匹配的原段。</p>}
    {!month && !query && orphans.value?.length ? <section><h2>独立历史回应</h2>{orphans.value.map(r=><article key={r.response_id} className="work-row"><small>{r.response_id} · {r.note}</small><button onClick={()=>readOrphan(r.response_id)}>{r.title_raw}</button></article>)}</section>:null}
    {orphans.error}
  </Sheet>
}

export function PhotoView({api,page,replace,read}:{api:DataAdapter;page:Extract<Page,{kind:'photo'}>;replace:(next:Page)=>void;read:(id:string)=>void}) {
  const data=useResource(()=>api.photo(page.photo),[page.photo])
  const group=useResource(()=>page.setId?api.album(page.setId):Promise.resolve(null),[page.setId])
  const present=useIsPresent(),reduced=useReducedMotionPreference(),direction=useRef(1)
  const photo=data.value
  const pane=useRef<HTMLElement>(null)
  const pendingTurn=useRef<{photo:string;setId:string;step:number}|null>(null)
  const wheelGesture=useRef({last:-Infinity,distance:0,turned:false})
  const holder=useRef<HTMLSpanElement>(null)
  const frames=useRef(new Map<string,Promise<HTMLImageElement|undefined>>())
  const [frameId,setFrameId]=useState(''),[imageFailed,setImageFailed]=useState(false)
  const [imageAttempt,retryImage]=useState(0)
  const ids=group.value?.items.map(p=>p.photo_id)??[page.photo]
  const index=ids.indexOf(page.photo), previous=ids[index-1], next=ids[index+1]
  useEffect(()=>{
    let active=true
    const cache=frames.current, current=page.photo
    const wanted=[current,previous,next].filter((id):id is string=>!!id)
    for(const id of cache.keys())if(!wanted.includes(id))cache.delete(id)
    function decode(id:string){
      const existing=cache.get(id)
      if(existing)return existing
      const image=new Image()
      image.className='mounted-photo';image.alt='照片 '+id
      image.decoding='async';image.fetchPriority=id===current?'high':'low'
      image.src=api.image(id)
      const ready=image.decode().then(()=>image,()=>{
        if(cache.get(id)===ready)cache.delete(id)
        return undefined
      })
      cache.set(id,ready)
      return ready
    }
    setImageFailed(false)
    decode(current).then(image=>{
      if(!active || !holder.current)return
      if(!image){setImageFailed(true);return}
      // Display precisely the decoded node. Keep the previous print on the board until it is ready.
      if(holder.current.firstChild!==image){
        const turning=!!holder.current.firstChild
        holder.current.replaceChildren(image)
        if(turning&&!reduced)image.animate([{opacity:.55,transform:'translateX('+direction.current*12+'px)'},{opacity:1,transform:'none'}],{duration:180,easing:paperCurve})
      }
      setFrameId(current)
    })
    for(const id of wanted.slice(1))void decode(id)
    return ()=>{active=false}
  },[api,page.photo,previous,next,imageAttempt,reduced])
  function turn(step:number){
    if(page.setId && !group.value){
      if(!group.error)pendingTurn.current={photo:page.photo,setId:page.setId,step}
      return
    }
    const target=index<0?undefined:ids[index+step]
    if(target){direction.current=Math.sign(step);replace({...page,photo:target})}
  }
  useLayoutEffect(()=>{
    const queued=pendingTurn.current
    if(!queued)return
    if(queued.photo!==page.photo || queued.setId!==page.setId || group.error){pendingTurn.current=null;return}
    if(group.value){pendingTurn.current=null;turn(queued.step)}
  },[page,group.value,group.error])
  useLayoutEffect(()=>{
    if(!present)return
    function key(e:KeyboardEvent){if(document.querySelector('dialog[open]'))return
      if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();turn(e.key==='ArrowRight'?1:-1)}}
    const el=pane.current
    function wheel(e:WheelEvent){
      if(!page.setId || (group.value && ids.length<2) || e.ctrlKey || e.shiftKey || !e.deltaY || Math.abs(e.deltaX)>Math.abs(e.deltaY) || document.querySelector('dialog[open]')) return
      e.preventDefault()
      const gesture=wheelGesture.current, now=performance.now()
      if(now-gesture.last>200){gesture.distance=0;gesture.turned=false}
      gesture.last=now
      if(gesture.turned) return
      gesture.distance+=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1)
      if(Math.abs(gesture.distance)>=24){gesture.turned=true;turn(Math.sign(gesture.distance))}
    }
    window.addEventListener('keydown',key);el?.addEventListener('wheel',wheel,{passive:false})
    return ()=>{window.removeEventListener('keydown',key);el?.removeEventListener('wheel',wheel)}
  },[group.value,group.error,page,present])
  const touch=useRef<{x:number;y:number}|null>(null)
  return <main ref={pane} className="photo-view" aria-label="照片浏览" data-photo={page.photo}>
    {group.error || data.error}
    <div className="viewer-board" onTouchStart={e=>{touch.current={x:e.touches[0].clientX,y:e.touches[0].clientY}}} onTouchEnd={e=>{
      if(!touch.current)return
      const dx=e.changedTouches[0].clientX-touch.current.x,dy=e.changedTouches[0].clientY-touch.current.y
      if(Math.abs(dx)>40 && Math.abs(dx)>Math.abs(dy))turn(dx<0?1:-1)
      touch.current=null
    }}><span ref={holder} className="photo-print"/>
      {imageFailed && <button onClick={()=>retryImage(n=>n+1)}>重新打开这张照片</button>}</div>
    <div className="viewer-controls"><button disabled={index<=0} onClick={()=>turn(-1)} aria-label="上一张">←</button>
      <span className="viewer-folio"><span className="folio-current"><AnimatePresence initial={false} mode="popLayout"><motion.span key={page.photo}
        initial={reduced?false:{opacity:0,y:direction.current*4}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:reduced?0:.15}}>{index+1}</motion.span></AnimatePresence></span> / {ids.length}</span><button disabled={index>=ids.length-1} onClick={()=>turn(1)} aria-label="下一张">→</button></div>
    <div>{[...new Set(photo && frameId===page.photo && photo.photo_id===frameId?photo.links.map(l=>l.entry_id):[])].map(id=><button key={id} onClick={()=>read(id)}>读当时写的那篇 · {id} ↗</button>)}</div>
  </main>
}
