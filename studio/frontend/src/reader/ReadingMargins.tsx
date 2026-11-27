import {trimTrailingBlankParagraphs} from '../core/paragraphs'
import {useLayoutEffect, useMemo, useState, type CSSProperties, type RefObject} from 'react'
import type {Entry} from '../types/archive'
import type {DiscoveryItem} from '../entrances/types'

type Pane = RefObject<HTMLElement|null>

export function ReadingMargins({pane,entry,items,active,reduced,onReply}:{
  pane:Pane; entry:Entry; items:DiscoveryItem[]; active:boolean; reduced:boolean; onReply?:()=>void
}) {
  useLayoutEffect(()=>{
    const el=pane.current
    if(!el || !active) return
    const events=new AbortController(), options={signal:events.signal,passive:true}
    let timer:number, resting=false, center:HTMLElement|undefined
    const arm=()=>{clearTimeout(timer);timer=window.setTimeout(rest,7000)}
    function wake() {
      if(resting){
        resting=false;el!.removeAttribute('data-quiet');center?.removeAttribute('data-center')
      }
      arm()
    }
    function rest() {
      if(document.hidden || document.querySelector('dialog[open]')) return
      const middle=el!.getBoundingClientRect().top+el!.clientHeight/2
      const paragraphs=Array.from(el!.querySelectorAll<HTMLElement>('[data-para]')).filter(p=>p.textContent?.trim())
      let nearest=Infinity
      for(const p of paragraphs){
        const box=p.getBoundingClientRect(), distance=Math.max(0,box.top-middle,middle-box.bottom)
        if(distance<nearest){nearest=distance;center=p}
      }
      if(!center) return
      center.dataset.center='';el!.dataset.quiet='';resting=true;clearTimeout(timer)
    }
    function key(e:KeyboardEvent){
      const target=e.target as HTMLElement
      if(e.key.toLowerCase()==='f' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing &&
        !target.closest?.('input,textarea,select,[contenteditable=true],dialog') && !document.querySelector('dialog[open]')){
        e.preventDefault();if(!e.repeat){if(resting)wake();else rest()}return
      }
      wake()
    }
    window.addEventListener('keydown',key,{signal:events.signal})
    for(const name of ['pointermove','wheel','touchstart','resize','focusin']) window.addEventListener(name,wake,options)
    document.addEventListener('visibilitychange',wake,options)
    document.addEventListener('close',wake,{...options,capture:true})
    el.addEventListener('scroll',wake,options)
    arm()
    return ()=>{
      events.abort();clearTimeout(timer);center?.removeAttribute('data-center');el.removeAttribute('data-quiet')
    }
  },[entry,active,pane])
  const marks=useMemo(()=>{
    const quoted=new Set(items.flatMap(i=>i.kind==='quote' && i.entryId===entry.entry_id?[i.paraId]:[]))
    return trimTrailingBlankParagraphs(entry.paragraphs).flatMap((p,i)=>{
      // Only an explicit paragraph heading locates a supplement. An entry-level
      // backfill note alone cannot establish which paragraph it refers to.
      const supplement=/^(?:[【（(\[])?(?:补记|补录|补写)(?:[】）)\]。．：:\s]|$)/u.test(p.text_raw.trimStart())
      if(!p.text_raw.trim()) return []
      const kind=supplement?(quoted.has(p.para_id)?'摘句与补录':'补录'):(quoted.has(p.para_id)?'摘句':'原段')
      return [{id:p.para_id, seq:i+1, kind, label:Array.from(p.text_raw.trim()).slice(0,8).join('')}]
    })
  },[entry,items])
  const [positions,setPositions]=useState<number[]>([])
  useLayoutEffect(()=>{
    const el=pane.current, sheet=el?.querySelector<HTMLElement>('.reading-sheet')
    if(!el || !sheet || !active) return
    function measure(){
      const box=sheet!.getBoundingClientRect()
      setPositions(marks.map(m=>{
        const p=document.getElementById(m.id)
        return p?Math.max(0,Math.min(100,(p.getBoundingClientRect().top-box.top)/Math.max(1,box.height)*100)):0
      }))
    }
    const observer=new ResizeObserver(measure)
    observer.observe(sheet);observer.observe(el);measure()
    return ()=>observer.disconnect()
  },[active,marks,pane])
  if(!active) return null
  return <>
    <nav className="mini-spine" aria-label="原段书脊刻度">
      <i className="spine-line" aria-hidden="true"/>
      {positions.length===marks.length && marks.map((m,i)=>{
        const point=positions[i], from=i?(positions[i-1]+point)/2:0
        const to=i+1<positions.length?(point+positions[i+1])/2:100
        const dot=(point-from)/Math.max(.001,to-from)*100+'%'
        return <button type="button" key={m.id} data-kind={m.kind} data-target={m.id} tabIndex={m.kind==='原段'?-1:0}
        aria-label={m.kind+' · 第 '+m.seq+' 段 · '+m.label} style={{top:from+'%',height:(to-from)+'%','--mark':dot} as CSSProperties}
        onClick={()=>{
          const el=pane.current, p=document.getElementById(m.id)
          if(el && p) el.scrollTo({top:el.scrollTop+p.getBoundingClientRect().top-el.getBoundingClientRect().top-64,
            behavior:reduced?'instant':'smooth'})
        }}><i className="spine-dot" aria-hidden="true"/><span aria-hidden="true" className="spine-label">{m.label}</span></button>})}
      {onReply && <button id="reply-spine" className="spine-bookmark" aria-label="查看当时的 AI 回应" onClick={onReply}>
        <svg className="bookmark-glyph" viewBox="0 0 9 15" width="9" height="15" aria-hidden="true">
          <path fill="currentColor" d="M1.5 1h6v12l-3-2.5-3 2.5z"/>
        </svg><span className="spine-label">当时的 AI 回应 ↗</span></button>}
    </nav>
  </>
}
