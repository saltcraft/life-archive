import {useId,useLayoutEffect,useRef,type ReactNode,type RefObject} from 'react'
import {useReducedMotionPreference} from './entrances/scheme-a/paperMotion'
import {exitCurve,paperCurve} from './motion/motionTokens'

export function PaperDialog({open,onDismiss,onClosed,busy=false,className,title,children,dialogRef}:{
  open:boolean;onDismiss:()=>void;onClosed?:()=>void;busy?:boolean;className:string;title:string;children:ReactNode;
  dialogRef?:RefObject<HTMLDialogElement|null>
}){
  const own=useRef<HTMLDialogElement>(null),ref=dialogRef??own,id=useId(),reduced=useReducedMotionPreference()
  const interrupted=useRef<{opacity:string;transform:string}|null>(null)
  const press=useRef(false),trigger=useRef<HTMLElement|null>(null),closed=useRef(onClosed)
  closed.current=onClosed
  useLayoutEffect(()=>{
    const el=ref.current
    if(!el || (!open&&!el.open))return
    const newlyOpened=!el.open
    if(newlyOpened){
      trigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null
      el.showModal()
    }
    el.dataset.shown=String(open)
    const finish=()=>{
      if(open || !el.open)return
      el.close()
      if(trigger.current?.isConnected && !trigger.current.closest('[inert]'))trigger.current.focus({preventScroll:true})
      closed.current?.()
    }
    if(reduced){interrupted.current=null;finish();return}
    const style=getComputedStyle(el)
    const start=newlyOpened?{opacity:0,transform:'translateY(4px) scale(.985)'}:interrupted.current??{opacity:style.opacity,transform:style.transform}
    interrupted.current=null
    const end=open?{opacity:1,transform:'none'}:{opacity:0,transform:'translateY(4px) scale(.985)'}
    const anim=el.animate([start,end],{duration:open?200:150,easing:open?paperCurve:exitCurve,fill:'both'})
    anim.onfinish=finish
    return ()=>{
      anim.onfinish=null
      if(el.open && el.isConnected){
        const frame=getComputedStyle(el)
        interrupted.current={opacity:frame.opacity,transform:frame.transform}
      }
      anim.cancel()
    }
  },[open,reduced,ref])
  function outside(el:HTMLDialogElement,x:number,y:number){
    const r=el.getBoundingClientRect();return x<r.left||x>r.right||y<r.top||y>r.bottom
  }
  return <dialog ref={ref} id={id} className={'paper-dialog '+className} aria-label={title}
    onCancel={e=>{e.preventDefault();if(!busy)onDismiss()}}
    onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();e.stopPropagation()}}}
    onPointerDown={e=>{press.current=e.target===e.currentTarget && outside(e.currentTarget,e.clientX,e.clientY)}}
    onClick={e=>{if(!busy && press.current && e.target===e.currentTarget && outside(e.currentTarget,e.clientX,e.clientY))onDismiss();press.current=false}}>
    <div inert={!open}>{children}</div></dialog>
}
