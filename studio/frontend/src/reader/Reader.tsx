import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DataAdapter } from '../api/adapter'
import type { Entry } from '../types/archive'
import { displayDate } from '../core/displayDate'
import { capture, restore, type ReadingMark } from '../core/navigation'

import { ReadingMargins } from './ReadingMargins'
import type { DiscoveryItem } from '../entrances/types'

import {motion,useIsPresent} from 'framer-motion'
import {DelayedStatus,Disclosure} from '../PaperControls'
import {enterPaper,exitPaper} from '../motion/motionTokens'

import {trimTrailingBlankParagraphs} from '../core/paragraphs'

export const fonts = ['华文中宋 · 温润','宋体 · 雅致','思源宋体 · 纤雅','华文仿宋 · 清癯']
export function Reader({gentle,id, api, covered, departing, font, resume, remember, onReply, back, returnLabel, items, reduced}: {
  gentle:boolean; items:DiscoveryItem[]; reduced:boolean;
  returnLabel?:string; id: string; api: DataAdapter; covered: boolean; departing: boolean; font: number; resume?: ReadingMark
  remember: (mark: ReadingMark) => void; onReply: (id: string, focus: string) => void; back: () => void
}) {
  const present=useIsPresent()
  const pane = useRef<HTMLElement>(null), bar = useRef<HTMLDivElement>(null)
  const [entry,setEntry] = useState<Entry>(), [failed,setFailed] = useState(false), [attempt,retry] = useState(0)
  const start = useRef(resume), moved = useRef(false)
  start.current=resume
  useEffect(() => {
    let alive = true
    api.entry(id).then(e => {if (alive) setEntry(e)}).catch(() => {if (alive) setFailed(true)})
    return () => {alive=false}
  }, [api,id,attempt])
  useLayoutEffect(() => {
    if(!present || departing){moved.current=false;return}
    if (!entry || !pane.current) return
    if(!moved.current){
      if(start.current)restore(pane.current,start.current)
      else pane.current.scrollTop=0
    }
    const el = pane.current
    const progress = () => {
      if (bar.current) bar.current.style.transform = 'scaleX('+el.scrollTop/Math.max(1,el.scrollHeight-el.clientHeight)+')'
    }
    progress()
    const observer = new ResizeObserver(progress)
    observer.observe(el); observer.observe(el.querySelector('article')!)
    el.addEventListener('scroll',progress,{passive:true})
    return () => {observer.disconnect();el.removeEventListener('scroll',progress)}
  }, [entry,present,departing])
  function record() { if (present && !covered && !departing && pane.current && entry) remember(capture(pane.current)) }
  const visible=entry?trimTrailingBlankParagraphs(entry.paragraphs):[]
  const link = entry?.links.find(l => l.link_status==='linked' && l.response_id)?.response_id
  const sourceNote = entry?.links.find(l => l.link_status==='unopened_scope'||l.link_status==='confirmed_none')?.note
  const replyButton = (where: string) => link && <button id={'reply-'+where} className="reply-link" onClick={() => {
    record(); onReply(link,'reply-'+where)
  }}>查看当时的 AI 回应 <span aria-hidden="true">↗</span></button>
  return <motion.main initial={!gentle||reduced?false:{opacity:0}} animate={{opacity:1}}
    exit={{opacity:0,transition:reduced||departing?{duration:0}:exitPaper}} transition={reduced?{duration:0}:enterPaper}
    data-leaving={!present || undefined} data-gentle={gentle || undefined} id="reader"  ref={pane} tabIndex={-1} className={'reading-pane font-'+font}
    inert={!present || covered || departing} aria-hidden={!present || covered || departing} style={{visibility:covered?'hidden':undefined}}
    onKeyDown={e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key))moved.current=true}}
    onScroll={record} onWheel={() => {moved.current=true}} onTouchMove={() => {moved.current=true}}>
    {entry && <ReadingMargins pane={pane} entry={entry} items={items} active={present && !covered && !departing} reduced={reduced} onReply={link ? ()=>{record();onReply(link,'reply-spine')} : undefined}/>}
    <div ref={bar} className="progress" aria-hidden="true"/>
    <article className="reading-sheet">
      <i className="reader-edge" aria-hidden="true"/>
      <motion.div className="reading-content" initial={!gentle||reduced?false:{y:12}} animate={{y:0}}
        exit={{y:gentle&&!reduced?8:0,transition:reduced||departing?{duration:0}:exitPaper}} transition={reduced?{duration:0}:enterPaper}>
        {entry ? <>
          {entry.photos.filter(p => p.placement==='hero_before_text').map(p =>
            <figure className="hero-frame" key={p.photo_id}><img src={api.image(p.photo_id)} width={p.width} height={p.height} alt="本篇已确认关联的照片"/></figure>)}
          <div className="entry-date">{displayDate(entry.entry_date)}</div>
          <h1>{entry.title_raw}</h1>
          <div className="prose">{visible.map(p => <Fragment key={p.para_id}><p id={p.para_id} data-para>{p.text_raw || '\u00a0'}</p>{entry.photos.filter(image=>image.placement==='after_paragraph'&&image.anchor_para_id===p.para_id).map(image=><figure key={image.photo_id} className="hero-frame"><img src={api.image(image.photo_id)} width={image.width} height={image.height} alt="本段已确认关联的照片"/></figure>)}</Fragment>)}{entry.photos.filter(photo=>photo.placement==='after_paragraph' && !visible.some(p=>p.para_id===photo.anchor_para_id)).map(photo=>
              <figure key={photo.photo_id} className="hero-frame"><img src={api.image(photo.photo_id)} width={photo.width} height={photo.height} alt="篇尾已确认关联的照片"/></figure>)}</div>
          {entry.photos.filter(image=>image.placement==='entry_level').map(image=><Disclosure className="source-detail" key={image.photo_id} label="本篇关联照片"><img src={api.image(image.photo_id)} width={image.width} height={image.height} alt="本篇关联照片"/></Disclosure>)}
          {entry.links.filter(l=>l.link_status==='linked' && l.response_id && l.response_id!==link).map(l=><button key={l.response_id} id={'reply-'+l.response_id} className="reply-link" onClick={()=>{record();onReply(l.response_id!,'reply-'+l.response_id)}}>查看当时的其他回应 · {l.response_id}</button>)}
          {sourceNote && <Disclosure className="source-detail" label="来源说明"><p>{sourceNote}</p></Disclosure>}
          <div className="read-end">{replyButton('end')}<button onClick={back}>{returnLabel??'回到原句'} <span aria-hidden="true">↩</span></button></div>
        </> : failed ? <button onClick={() => {setFailed(false);retry(n=>n+1)}}>未能读取，重新打开</button> : <DelayedStatus>正在打开…</DelayedStatus>}
      </motion.div>
    </article>
  </motion.main>
}
