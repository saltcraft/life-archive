import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'framer-motion'
import type { DiscoveryItem, EntranceProps } from '../types'
import type { Entry } from '../../types/archive'

type Quote = Extract<DiscoveryItem, {kind:'quote'}>
import {TACTILE_SPRING as spring} from '../../motion/motionTokens'
const clamp = (n:number) => Math.max(-1, Math.min(1,n))

function afterQuote(entry:Entry, item:Quote) {
  const start = entry.paragraphs.findIndex(p => p.para_id === item.paraId)
  if (start < 0) return ''
  const tail = Array.from(entry.paragraphs[start].text_raw).slice(item.charEnd).join('')
  const parts = [tail, ...entry.paragraphs.slice(start+1).map(p=>p.text_raw)]
  return Array.from(parts.map(s=>s.trim()).filter(Boolean).join('\n')).slice(0,20).join('')
}

function imprint(item:Quote) {
  const date = item.entryDate.match(/(\d{4})\D+(\d{1,2})(?!\d)/)
  if (!date || Number(date[2]) < 1 || Number(date[2]) > 12) return ''
  return date[1].slice(-2)+' · '+date[2].padStart(2,'0')
}

import type {BookPulse} from './quoteTurn'

interface Preview {id:string; title:string; text:string}
interface LeafProps {
  index:number; breathFan:MotionValue<number>; mx:MotionValue<number>; my:MotionValue<number>; fan:MotionValue<number>
  item:Quote; reduced:boolean; active:boolean; preview?:Preview
}
function Leaf({index,breathFan,mx,my,fan,item,reduced,active,preview}:LeafProps) {
  const depth=index-1.5
  const thickness=Math.min(6,Math.log2(Math.max(1,item.entryCount))*1.15)
  const x=useTransform(()=>depth*(fan.get()*3.8+mx.get()*2.4))
  const y=useTransform(()=>depth*(-fan.get()*1.8+my.get()*1.8))
  const rotate=useTransform(()=>depth*(fan.get()*1.35+mx.get()*1.3) - depth/3*breathFan.get())
  const shine = useTransform(mx,[-1,1],['-48%','48%'])
  const shineY = useTransform(my,[-1,1],['-10%','10%'])
  const front = index===3
  return <motion.i className={'leaf leaf-'+index} style={{
    x:reduced?0:x, y:reduced?0:y, rotate:reduced?0:rotate,
    marginRight:index===2?-thickness:undefined,
    transformOrigin:front?'left center':undefined
  }}>
    {index===2 && <motion.span className="preview-slip" data-open={active} aria-hidden="true"
      initial={false} animate={{x:active?'18%':'0%',y:active?'-100%':'38%',opacity:active?1:0}}
      transition={reduced?{duration:0}:{...spring,opacity:{duration:active ? 0.12 : 0.15}}}>
      <span className="slip-title">{preview?.title}</span><span className="slip-excerpt">{preview?.text}</span>
    </motion.span>}
    {index===2 && item.linked && <span className="book-ribbon" aria-hidden="true"/>}
    {front && <>
      <span className="cover-imprint" aria-hidden="true">{imprint(item)}</span>
      <span className="shine-mask" aria-hidden="true"><motion.span className="cover-shine"
        style={{x:shine,y:shineY,opacity:reduced?0:fan}}/></span>
    </>}
  </motion.i>
}

export function MagneticAnchor({item,loadEntry,reduced,visible,setActive,onOpen,pulse}:{
  item:Quote; loadEntry:EntranceProps['loadEntry']; reduced:boolean; visible:boolean; pulse?:BookPulse
  setActive:(active:boolean)=>void; onOpen:()=>void
}) {
  const tx=useMotionValue(0), ty=useMotionValue(0), engagement=useMotionValue(0)
  const mx=useSpring(tx,spring), my=useSpring(ty,spring), fan=useSpring(engagement,spring)
  const breathFan=useSpring(0,spring),breathY=useSpring(0,spring)
  useLayoutEffect(()=>{
    if(!pulse || !visible || reduced){breathFan.jump(0);breathY.jump(0);return}
    const opening=pulse.deltaY>0
    breathFan.set(opening?1.8:-1);breathY.set(opening?-2.6:1.5)
    const timer=window.setTimeout(()=>{breathFan.set(0);breathY.set(0)},170)
    return ()=>clearTimeout(timer)
  },[pulse,visible,reduced,breathFan,breathY])
  const x=useTransform(mx,[-1,1],[-18,18]), y=useTransform(()=>my.get()*18+breathY.get())
  const tiltX=useTransform(my,[-1,1],[7,-7]), tiltY=useTransform(mx,[-1,1],[-7,7])
  const bounds=useRef<DOMRect|undefined>(undefined)
  const [inZone,setInZone]=useState(false), [preview,setPreview]=useState<Preview>()
  const [openId,setOpenId]=useState<string>()
  useEffect(()=>{
    if(!visible || reduced){tx.set(0);ty.set(0);engagement.set(0);setActive(false)}
    if(!visible){setInZone(false);setOpenId(undefined)}
  },[visible,reduced,tx,ty,engagement,setActive])
  useEffect(()=>{
    if(!visible || !inZone) return
    let live=true
    const timer=window.setTimeout(async()=>{
      try {
        const entry=await loadEntry(item.entryId)
        if(live){setPreview({id:item.quoteId,title:entry.title_raw,text:afterQuote(entry,item)});setOpenId(item.quoteId)}
      } catch { /* The cover continues to open the full entry. */ }
    },400)
    return ()=>{live=false;clearTimeout(timer)}
  },[visible,inZone,item,loadEntry])
  function closeSlip(){setInZone(false);setOpenId(undefined)}
  function leaveZone(e:PointerEvent<HTMLElement>) {
    const next=e.relatedTarget
    if(!(next instanceof Element && next.closest('.slip-target,.preview-slip[data-open=true]')))closeSlip()
  }
  function move(e:PointerEvent<HTMLButtonElement>, rect=bounds.current) {
    if (!rect || reduced || e.pointerType==='touch') return
    tx.set(clamp(2*(e.clientX-rect.left)/rect.width-1))
    ty.set(clamp(2*(e.clientY-rect.top)/rect.height-1))
  }
  function release() {
    bounds.current=undefined;tx.set(0);ty.set(0);engagement.set(0);setActive(false);closeSlip()
  }
  return <button id="stage-anchor" className="anchor" aria-label="由纸页进入全文" onClick={onOpen}
    onPointerEnter={e=>{
      if(e.pointerType==='touch') return
      bounds.current=e.currentTarget.getBoundingClientRect()
      setActive(true);engagement.set(reduced?0:1);move(e,bounds.current)
    }} onPointerMove={e=>move(e)} onPointerOut={e=>{if(e.target instanceof Element && e.target.closest('.preview-slip'))leaveZone(e)}} onPointerLeave={release} onPointerCancel={release} onBlur={release}>
    <motion.span className="anchor-stack" style={{x:reduced?0:x,y:reduced?0:y,rotateX:reduced?0:tiltX,rotateY:reduced?0:tiltY}}>
      {[0,1,2,3].map(index=><Leaf key={index} index={index} breathFan={breathFan} mx={mx} my={my} fan={fan}
        reduced={reduced} item={item} active={visible && inZone && openId===item.quoteId}
        preview={preview?.id===item.quoteId?preview:undefined}/>)}
    </motion.span>
    <span className="slip-target" aria-hidden="true" onPointerEnter={e=>{if(e.pointerType!=='touch')setInZone(true)}} onPointerLeave={leaveZone}/>
  </button>
}
