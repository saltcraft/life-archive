import {useLayoutEffect,useRef,useState} from 'react'
import {flushSync} from 'react-dom'
import type {DiscoveryItem} from '../types'
import {exitCurve,paperCurve} from '../../motion/motionTokens'

type Quote = Extract<DiscoveryItem,{kind:'quote'}>
export type BookPulse = {deltaY:number}
const shift=(y:number)=>'translateY('+y+'px)'
export const quoteClass=(text:string,base='quote')=>(text.match(/\p{Script=Han}/gu)?.length??0)>38?base+' quote-long':base

// The invisible line box occupies exactly the same width as the ink. It can
// take the next layout while the old ink is still on the paper.
export function useQuoteTurn(item:Quote,direction:number,enabled:boolean){
  const copy=useRef<HTMLDivElement>(null)
  const [shown,setShown]=useState(item),[pulse,setPulse]=useState<BookPulse>()
  const active=useRef(new Set<Animation>()),geometry=useRef('')
  const cancel=()=>{
    for(const track of active.current){track.onfinish=null;track.cancel()}
    active.current.clear()
  }
  useLayoutEffect(()=>()=>cancel(),[])
  useLayoutEffect(()=>{
    const root=copy.current!
    const one=(selector:string)=>root.querySelector<HTMLElement>(selector)!
    const ink=one('#stage-clue'), measure=one('.quote-measure')
    const quote=one('.quotation'),date=one('.clue-date'),action=one('.stage-action')
    const dateText=one('.date-ink')
    const top=(el:HTMLElement)=>el.getBoundingClientRect().top
    const tops=()=>({quote:top(quote),date:top(date),action:top(action),ink:top(ink)})
    const first=tops(),opacity=getComputedStyle(ink).opacity,dateOpacity=getComputedStyle(dateText).opacity
    const previous=geometry.current, interrupted=active.current.size>0
    cancel()
    measure.className=quoteClass(item.quoteText,'quote-measure')
    measure.textContent=item.quoteText
    geometry.current=item.quoteId
    if(!previous || !enabled || previous===item.quoteId){
      setShown(item);setPulse(undefined);return
    }

    const last=tops()
    const inverse=(part:keyof typeof first)=>first[part]-last[part]
    const dy=-inverse('action'),moving=Math.abs(dy)>=2
    const fading=shown.quoteId!==item.quoteId
    const swapAt=fading?(interrupted?75:150):0
    const delay=interrupted?0:Math.max(0,swapAt-40)
    function animate(el:HTMLElement,frames:Keyframe[],ms:number,wait=0,easing=paperCurve,done?:()=>void){
      const track=el.animate(frames,{duration:ms,delay:wait,easing,fill:'both'})
      active.current.add(track)
      track.onfinish=()=>{
        active.current.delete(track)
        track.cancel()
        done?.()
      }
      return track
    }
    function glide(node:HTMLElement,offset:number){
      if(Math.abs(offset)>=2 || (interrupted && offset!==0))
        animate(node,[{transform:shift(offset)},{transform:'none'}],240,delay)
    }
    glide(quote,inverse('quote'));glide(date,inverse('date'));glide(action,-dy)

    if(moving)setPulse({deltaY:dy})

    const reveal=()=>{
      animate(ink,[{opacity:fading?0:opacity,transform:shift(fading?inkTravel*7:inverse('ink'))},{opacity:1,transform:'none'}],220)
      animate(dateText,[{opacity:fading?0:dateOpacity},{opacity:1}],180)
    }
    const inkTravel=moving?direction:0
    if(fading){
      const dateFade=animate(dateText,[{opacity:dateOpacity},{opacity:0}],swapAt,0,exitCurve)
      dateFade.onfinish=null // Hold the old date invisible until the ink commits.
      animate(ink,[{opacity,transform:shift(inverse('ink'))},{opacity:0,transform:shift(inverse('ink')-inkTravel*8)}],swapAt,0,exitCurve,()=>{
        active.current.delete(dateFade);dateFade.cancel()
        flushSync(()=>setShown(item))
        reveal()
      })
    }else reveal()
  },[item.quoteId,item.quoteText,item.entryDate,direction,enabled])
  const current=shown.quoteId===item.quoteId && shown.quoteText===item.quoteText && shown.entryDate===item.entryDate
  return {copy,shown:current?item:shown,pulse}
}
