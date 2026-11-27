import { useLayoutEffect,useEffect, useRef, useState } from 'react'
import type { DataAdapter } from '../api/adapter'
import type { Block, Reply } from '../types/archive'

import {motion,useIsPresent} from 'framer-motion'
import {enterPaper,exitPaper} from '../motion/motionTokens'
import {useReducedMotionPreference} from '../entrances/scheme-a/paperMotion'
import {DelayedStatus} from '../PaperControls'

import {capture,restore,type ReadingMark} from '../core/navigation'

function content(b: Block) {
  return b.runs?.map(([kind,value],i) => {
    if (kind === 'bold') return <strong key={i}>{value}</strong>
    if (kind === 'break') return <br key={i}/>
    if (kind === 'tab') return '\t'
    return value
  }) ?? b.text
}
export function ReplyView({ api, id, back,resume,remember, backLabel='返回正文' }: {resume?:ReadingMark;remember:(mark:ReadingMark)=>void;api: DataAdapter; id: string; back: () => void;backLabel?:string}) {
  const [reply,setReply] = useState<Reply>(), [error,setError] = useState(false), [attempt,setAttempt] = useState(0)
  const reduced=useReducedMotionPreference(),present=useIsPresent()
  const root = useRef<HTMLElement>(null)
  const mark=useRef(resume),moved=useRef(false)
  mark.current=resume
  useLayoutEffect(()=>{
    if(!present){moved.current=false;return}
    if(reply && root.current && !moved.current){
      if(mark.current)restore(root.current,mark.current)
      else root.current.scrollTop=0
    }
  },[reply,present])
  useEffect(() => {
    let alive = true
    root.current?.focus({preventScroll:true})
    api.reply(id).then(r => {if (alive) setReply(r)}).catch(() => {if (alive) setError(true)})
    return () => {alive=false}
  },[api,id,attempt])
  return <motion.main onKeyDown={e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key))moved.current=true}}
    onWheel={()=>{moved.current=true}} onTouchMove={()=>{moved.current=true}}
    onScroll={()=>{if(present && reply && root.current)remember(capture(root.current))}} inert={!present} aria-hidden={!present} initial={reduced?false:{opacity:0,y:10}} animate={{opacity:1,y:0}}
    exit={{opacity:0,y:reduced?0:10,transition:reduced?{duration:0}:exitPaper}} transition={reduced?{duration:0}:enterPaper} ref={root} className="reply-pane" id="reply" tabIndex={-1}><article className="reading-sheet">
    <div className="entry-date">历史回应 <i>／</i> {id}</div><h1>{reply?.title_raw || '当时的 AI 回应'}</h1>
    {error ? <button onClick={() => {setError(false);setAttempt(n=>n+1)}}>读取失败，重试</button> :
     !reply ? <DelayedStatus>正在打开…</DelayedStatus> : <div className="prose">{reply.blocks.map((b,i) => {
       const anchor={id:'reply-block-'+i,'data-para':true}
       switch (b.type) {
         case 'table': return <table key={i} {...anchor}><tbody>{b.cells ? b.cells.map((row,r)=>
           <tr key={r}>{row.map((cell,c)=><td key={c}>{cell.map((p,j)=><p key={j}>{content(p)}</p>)}</td>)}</tr>) : b.rows?.map((row,r) => <tr key={r}>{row.map((v,c) => r===0 ? <th key={c}>{v}</th> : <td key={c}>{v}</td>)}</tr>)}</tbody></table>
         case 'rule': return <div key={i} {...anchor}>{content(b)}<hr/></div>
         case 'bullet': return <ul key={i} {...anchor}><li>{content(b)}</li></ul>
         case 'user_followup': return <blockquote key={i} {...anchor}><small>本人追问 {b.followup_id}</small>{content(b)}</blockquote>
         case 'gap_notice': return <aside key={i} {...anchor}>{content(b)}</aside>
         default: return <p key={i} {...anchor}>{content(b) || '\u00a0'}</p>
       }
     })}</div>}
    <div className="read-end"><button onClick={back}>{backLabel} ↩</button></div>
  </article></motion.main>
}
