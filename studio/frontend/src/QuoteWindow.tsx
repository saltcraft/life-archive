import {memo,useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {AnimatePresence,motion} from 'framer-motion'
import type {DiscoveryItem} from './entrances/types'
import type {Entry} from './types/archive'
import {PaperSelect} from './PaperFields'
import {enterPaper,exitPaper} from './motion/motionTokens'
import {useReducedMotionPreference} from './entrances/scheme-a/paperMotion'

import {trimTrailingBlankParagraphs} from './core/paragraphs'

type Paragraph=Entry['paragraphs'][number]
type Slice={id:string;start:number;end:number;text:string}
export type CollectedQuote=Extract<DiscoveryItem,{kind:'quote'}>
type Interval=[number,number,string[]]
const empty:Interval[]=[]
const preview=(s:string,n:number)=>Array.from(s).slice(0,n).join('')

function highlights(entry:Entry,items:DiscoveryItem[]){
  const ranges=new Map<string,Interval[]>()
  const paragraphs=new Map(entry.paragraphs.map(p=>[p.para_id,Array.from(p.text_raw)]))
  for(const q of items){
    if(q.kind!=='quote'||q.entryId!==entry.entry_id||!q.quoteText)continue
    const start=q.charEnd-Array.from(q.quoteText).length, chars=paragraphs.get(q.paraId)
    if(!chars || start<0 || q.charEnd>chars.length || chars.slice(start,q.charEnd).join('')!==q.quoteText)continue
    const spans=ranges.get(q.paraId)??[]
    spans.push([start,q.charEnd,[q.quoteId]]);ranges.set(q.paraId,spans)
  }
  for(const [id,spans] of ranges){
    const boundaries=[...new Set(spans.flatMap(([a,b])=>[a,b]))].sort((a,b)=>a-b)
    const segments:Interval[]=[]
    for(let i=1;i<boundaries.length;i++){
      const a=boundaries[i-1],b=boundaries[i]
      const ids=spans.filter(([start,end])=>start<=a && end>=b).flatMap(span=>span[2])
      if(ids.length)segments.push([a,b,ids])
    }
    ranges.set(id,segments)
  }
  return ranges
}
const Line=memo(function Line({p,n,ranges}:{p:Paragraph;n:number;ranges:Interval[]}){
  const chars=Array.from(p.text_raw),parts=[];let at=0
  for(const [a,b,ids] of ranges){
    parts.push(chars.slice(at,a).join(''),<mark key={a} data-quotes={JSON.stringify(ids)}>{chars.slice(a,b).join('')}</mark>);at=b
  }
  return <div className="quote-line" data-line={p.para_id}><span aria-hidden="true" data-marked={!!ranges.length}>{String(n).padStart(2,'0')}</span>
    <p data-para-body={p.para_id}>{parts}{chars.slice(at).join('')}</p></div>
})
function body(node:Node){return (node instanceof Element?node:node.parentElement)?.closest<HTMLElement>('[data-para-body]')}
export function QuoteWindow({entry,items,para,activate,confirm,remove}:{entry:Entry;items:DiscoveryItem[];para:string;activate:(id:string)=>void;
  remove:(q:CollectedQuote)=>void;confirm:(s:Slice,n:number)=>Promise<string|undefined>}){
  const view=useRef<HTMLDivElement>(null),bar=useRef<HTMLDivElement>(null),pulse=useRef<Animation|null>(null)
  const marks=useMemo(()=>highlights(entry,items),[entry,items])
  const [picked,setPicked]=useState<string[]>([])
  const pickedQuotes=items.filter((q):q is CollectedQuote=>q.kind==='quote' && q.paraId===para && picked.includes(q.quoteId))
  const [slice,setSlice]=useState<Slice|null>(null),[cross,setCross]=useState(false)
  const reduced=useReducedMotionPreference(),rows=useMemo(()=>trimTrailingBlankParagraphs(entry.paragraphs),[entry.paragraphs])
  const index=rows.findIndex(p=>p.para_id===para)
  const options=useMemo(()=>rows.map((p,i)=>[p.para_id,(marks.has(p.para_id)?'● ':'')+'第 '+(i+1)+' 段 · '+(preview(p.text_raw,12)||'空段')] as const),[rows,marks])
  const jump=useCallback((n:number)=>{
    const row=rows[n],pane=view.current
    if(!row || !pane)return
    const el=pane.querySelector<HTMLElement>('[data-line="'+CSS.escape(row.para_id)+'"]')
    if(!el)return
    setPicked([]);document.getSelection()?.removeAllRanges();activate(row.para_id)
    pane.scrollTo({top:pane.scrollTop+el.getBoundingClientRect().top-pane.getBoundingClientRect().top-12,behavior:reduced?'instant':'smooth'})
    pulse.current?.cancel()
    if(!reduced)pulse.current=el.animate([{backgroundColor:'#dce7d9'},{backgroundColor:'transparent'}],{duration:600})
  },[rows,activate,reduced])
  useEffect(()=>{
    const node=bar.current
    let last=-Infinity,distance=0,turned=false
    function wheel(e:WheelEvent){
      if(e.ctrlKey||!e.deltaY||(e.target instanceof Element && e.target.closest('.paper-popup')))return
      e.preventDefault();const now=performance.now()
      if(now-last>170){distance=0;turned=false}
      last=now;distance+=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?300:1)
      if(!turned && Math.abs(distance)>=16){turned=true;const pos=rows.findIndex(p=>p.para_id===node?.dataset.current);jump(pos+Math.sign(distance))}
    }
    node?.addEventListener('wheel',wheel,{passive:false})
    return ()=>node?.removeEventListener('wheel',wheel)
  },[rows,jump])
  useEffect(()=>{
    const pane=view.current
    function inspect(){
      const sel=document.getSelection(),range=sel?.rangeCount?sel.getRangeAt(0):null
      if(!range||range.collapsed||!pane){setSlice(null);setCross(false);return}
      setPicked([])
      const first=body(range.startContainer),last=body(range.endContainer)
      const inside=pane.contains(range.startContainer)||pane.contains(range.endContainer)
      setCross(inside && first!==last)
      if(!first||first!==last||!pane.contains(first)){setSlice(null);return}
      const p=rows.find(p=>p.para_id===first.dataset.paraBody)
      if(!p){setSlice(null);return}
      const prefix=range.cloneRange();prefix.selectNodeContents(first);prefix.setEnd(range.startContainer,range.startOffset)
      const text=range.toString(),start=Array.from(prefix.toString()).length,end=start+Array.from(text).length
      activate(p.para_id);setSlice(text && Array.from(p.text_raw).slice(start,end).join('')===text?{id:p.para_id,start,end,text}:null)
    }
    document.addEventListener('selectionchange',inspect);pane?.addEventListener('pointerup',inspect);pane?.addEventListener('keyup',inspect)
    return ()=>{document.removeEventListener('selectionchange',inspect);pane?.removeEventListener('pointerup',inspect);pane?.removeEventListener('keyup',inspect);pulse.current?.cancel()}
  },[rows,activate])
  async function save(){
    if(slice && await confirm(slice,rows.findIndex(p=>p.para_id===slice.id)+1)){
      document.getSelection()?.removeAllRanges();setSlice(null)
    }
  }
  useEffect(()=>{
    if(!slice&&!cross)return
    function key(e:KeyboardEvent){
      if(document.querySelector('dialog[open]') || view.current?.closest('[inert],fieldset:disabled'))return
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();document.getSelection()?.removeAllRanges();setSlice(null);setCross(false)}
      if(slice && (e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();void save()}
    }
    window.addEventListener('keydown',key,true);return ()=>window.removeEventListener('keydown',key,true)
  },[slice,cross,confirm])
  return <section className="quote-window" aria-label="在原文中划选"><div className="para-bar" ref={bar} data-current={para}>
    <button type="button" disabled={index<=0} onClick={()=>jump(index-1)}>‹ 上一段</button>
    <PaperSelect label="段号快跳" options={options} value={para} display={'第 '+(index+1)+' / 共 '+rows.length+' 段'} change={id=>jump(rows.findIndex(p=>p.para_id===id))}/>
    <button type="button" disabled={index>=rows.length-1} onClick={()=>jump(index+1)}>下一段 ›</button></div>
    <div ref={view} className="quote-scroll" tabIndex={0} role="region" aria-label="日记全文划选" onPointerDown={e=>{
      setPicked([]);const id=(e.target as Element).closest<HTMLElement>('[data-line]')?.dataset.line;if(id)activate(id)
    }} onClick={e=>{
      const mark=(e.target as Element).closest<HTMLElement>('mark[data-quotes]')
      if(mark && document.getSelection()?.isCollapsed)setPicked(JSON.parse(mark.dataset.quotes!))
    }}>{rows.map((p,i)=><Line key={p.para_id} p={p} n={i+1} ranges={marks.get(p.para_id)??empty}/>)}</div>
    <div className="selection-slot" aria-live="polite"><AnimatePresence>
      {!slice && !cross && !!pickedQuotes.length && <motion.div key="collected" className="selection-bar picked-quotes"
        initial={reduced?false:{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={reduced?{duration:0}:enterPaper}>
        {pickedQuotes.map(q=><div key={q.quoteId}><span>已收摘句 · 第 {index+1} 段「{preview(q.quoteText,30)}」</span>
          <button type="button" onClick={()=>remove(q)}>移出此句</button></div>)}</motion.div>}
      {(slice||cross) && <motion.div key="confirm" className="selection-bar" initial={reduced?false:{opacity:0,y:4}} animate={{opacity:1,y:0}}
        exit={{opacity:0,transition:reduced?{duration:0}:exitPaper}} transition={reduced?{duration:0}:enterPaper}>
        <span>{cross?'摘句需落在同一原段内':slice && ('第 '+(index+1)+' 段 · 第 '+(slice.start+1)+'–'+slice.end+' 字「'+preview(slice.text,26)+'」')}</span>
        <button type="button" disabled={!slice} onMouseDown={e=>e.preventDefault()} onClick={save}>确认摘句</button></motion.div>}
    </AnimatePresence></div></section>
}
