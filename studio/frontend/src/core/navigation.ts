import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {newId} from './newId'

export type Desk = 'lookup' | 'albums' | 'curate'
export type Page = {kind:'stage'; photoAnchor?:string; setId?:string|null} | {kind:Desk; initialSection?:'收日记'} | {kind:'photo'; photo:string; setId?:string|null; via?:'stage'|'albums'} | {kind:'entry'; entry: string; via?:string; para?:string} | {kind:'reply'; entry?: string; reply: string}
function nativeState(){try{return history.state}catch{return null}}
const readPage = (): Page => nativeState()?.laPage ?? {kind:'stage'}
export function usePage(root:RefObject<HTMLElement|null>) {
  const [page, setPage] = useState<Page>(readPage)
  const epoch=useRef<string|undefined>(nativeState()?.laEpoch)
  const stack=useRef<Page[]>([page])
  const cursor=useRef(0), memoryOnly=useRef(false)
  function writeNative(method:'pushState'|'replaceState',next:Page){
    if(memoryOnly.current)return
    try{history[method]({laPage:next,laEpoch:epoch.current,laPosition:cursor.current},'')}
    catch{memoryOnly.current=true}
  }
  function stepMemory(delta:number){
    const pos=cursor.current+delta
    if(pos<0 || pos>=stack.current.length)return
    cursor.current=pos;setPage(available(stack.current[pos]))
  }
  const keyboardHistory=useRef(false)
  const hidden=useRef(new Set<string>())
  function markVisibility(kind:string,id:string,visible:boolean){
    const key=kind+'/'+id
    if(visible)hidden.current.delete(key);else hidden.current.add(key)
  }
  function available(next:Page):Page{
    const absent=hidden.current
    if((next.kind==='entry'||next.kind==='reply') && next.entry && absent.has('entry/'+next.entry))return {kind:'stage'}
    if(next.kind==='photo' && absent.has('photo/'+next.photo))return {kind:'stage'}
    if(next.kind==='stage' && next.photoAnchor && absent.has('photo/'+next.photoAnchor))return {kind:'stage'}
    if((next.kind==='photo'||next.kind==='stage') && next.setId && absent.has('photo_set/'+next.setId))return {...next,setId:null}
    return next
  }
  useLayoutEffect(() => {
    const el=root.current
    if(!el)return
    const events=new AbortController()
    const capture={capture:true,passive:true,signal:events.signal}
    const mode=(value:'keyboard'|'pointer')=>{if(el.dataset.input!==value)el.dataset.input=value}
    const pointer=()=>{keyboardHistory.current=false;mode('pointer')}
    pointer()
    for(const name of ['pointerdown','pointermove','pointerup','mousedown','auxclick','touchstart','wheel'])
      window.addEventListener(name,pointer,capture)
    window.addEventListener('keydown',e=>{
      if(memoryOnly.current){
        const delta=e.key==='BrowserBack'||(e.altKey && e.key==='ArrowLeft')?-1:
          e.key==='BrowserForward'||(e.altKey && e.key==='ArrowRight')?1:0
        if(delta){e.preventDefault();stepMemory(delta);return}
      }
      if(['Tab','Enter',' ','Escape','BrowserBack','BrowserForward'].includes(e.key) || e.key.startsWith('Arrow')) {
        mode('keyboard')
        keyboardHistory.current=e.key.startsWith('Browser') || (e.altKey && (e.key==='ArrowLeft'||e.key==='ArrowRight'))
      }
    },{...capture,passive:false})
    writeNative('replaceState',page)
    const pop = () => {
      mode(keyboardHistory.current?'keyboard':'pointer');keyboardHistory.current=false
      if(memoryOnly.current)return
      const saved=nativeState()
      const next=available(saved?.laEpoch===epoch.current?readPage():{kind:'stage'})
      cursor.current=Math.min(stack.current.length,Math.max(0,saved?.laPosition??0))
      stack.current[cursor.current]=next
      writeNative('replaceState',next)
      setPage(next)
    }
    window.addEventListener('popstate',pop,{signal:events.signal})
    return ()=>events.abort()
  },[root])
  const back=useCallback(()=>{
    keyboardHistory.current=root.current?.dataset.input==='keyboard'
    if(memoryOnly.current)stepMemory(-1)
    else try{history.back()}catch{memoryOnly.current=true;stepMemory(-1)}
  },[root])
  function open(requested:Page) {
    const next=available(requested)
    stack.current.splice(cursor.current+1,Infinity,next);cursor.current++
    writeNative('pushState',next)
    setPage(next)
  }
  function replace(next:Page) {
    stack.current[cursor.current]=next
    writeNative('replaceState',next)
    setPage(next)
  }
  function reset(){hidden.current.clear();epoch.current=newId();stack.current=[];cursor.current=0;replace({kind:'stage'})}
  return {page, open, replace, reset, back, markVisibility}
}

export interface ReadingMark { para: string; offset: number; scroll: number }
// Measure in layout coordinates even while the inner reading sheet is arriving.
function readingTop(pane:HTMLElement){
  const content=pane.querySelector<HTMLElement>('.reading-content')
  const transform=content && getComputedStyle(content).transform
  const translation=transform && transform!=='none'?new DOMMatrixReadOnly(transform).m42:0
  return pane.getBoundingClientRect().top+64+translation
}
export function capture(pane: HTMLElement): ReadingMark {
  const top = readingTop(pane)
  const anchor = [...pane.querySelectorAll<HTMLElement>('[data-para]')].find(el => el.getBoundingClientRect().bottom > top)
  return {para: anchor?.id ?? '', offset: anchor ? anchor.getBoundingClientRect().top-top : 0, scroll: pane.scrollTop}
}
export function restore(pane: HTMLElement, mark: ReadingMark) {
  const anchor = mark.para?pane.querySelector<HTMLElement>('#'+CSS.escape(mark.para)):null
  if (anchor && pane.contains(anchor)) pane.scrollTop += anchor.getBoundingClientRect().top - readingTop(pane) - mark.offset
  else pane.scrollTop = mark.scroll
}
