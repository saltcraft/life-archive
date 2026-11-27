import {useEffect,useId,useState,type ReactNode} from 'react'
import {AnimatePresence,motion,useIsPresent} from 'framer-motion'
import {useReducedMotionPreference} from './entrances/scheme-a/paperMotion'

import {PAPER_EASE as ease,EXIT_EASE,TACTILE_SPRING as spring} from './motion/motionTokens'
const glide={duration:.22,ease}

export function DelayedStatus({children}:{children:ReactNode}){
  const [visible,setVisible]=useState(false)
  useEffect(()=>{const timer=setTimeout(()=>setVisible(true),150);return ()=>clearTimeout(timer)},[])
  return visible?<span className="delayed-status" role="status">{children}</span>:null
}
export function Disclosure({label,className,children}:{label:string;className:string;children:ReactNode}){
  const [open,setOpen]=useState(false),id=useId()
  return <div className={className}><button type="button" className="disclosure" aria-expanded={open} aria-controls={id}
    onClick={()=>setOpen(v=>!v)}><FoldChevron/>{label}</button><PaperFold id={id} open={open}>{children}</PaperFold></div>
}

/** Each row owns a single moving plate. The radio inputs retain native arrow-key navigation. */
export function PaperPills<T extends string>({label,options,value,change,buttons=false}:{
  label:string; options:readonly (readonly [T,string])[]; value:T|''; change:(value:T)=>void; buttons?:boolean
}) {
  const id=useId(), reduced=useReducedMotionPreference()
  const contents=(key:T,text:string)=><>{value===key && (reduced?<i className="pill-plate" aria-hidden="true"/>:
    <motion.i className="pill-plate" aria-hidden="true" layoutId={id} transition={spring}/>)}<span className="pill-label">{text}</span></>
  if(buttons)return <div className="work-tabs curation-actions" role="group" aria-label={label}>
    {options.map(([key,text])=><button key={key} type="button" aria-pressed={value===key} onClick={()=>change(key)}>{contents(key,text)}</button>)}
  </div>
  return <fieldset className="pill-field"><legend>{label}</legend><div className="filter-pills">
    {options.map(([key,text])=><label key={key}><input type="radio" name={id} value={key} checked={key===value} onChange={()=>change(key)}/>{contents(key,text)}</label>)}
  </div></fieldset>
}

function ChangingPanel({children}:{children:ReactNode}){
  const present=useIsPresent(),reduced=useReducedMotionPreference()
  return <motion.fieldset className="changing-panel" disabled={!present} data-leaving={!present || undefined} inert={!present} initial={reduced?false:{opacity:0,y:6}} animate={{opacity:1,y:0}}
    exit={{opacity:reduced?1:0,y:reduced?0:-6,transition:{duration:reduced?0:.15,ease:EXIT_EASE}}}
    transition={{duration:reduced?0:.2,ease}}>{children}</motion.fieldset>
}
export function PanelSwap({identity,children}:{identity:string;children:ReactNode}){
  return <div className="swap-slot"><AnimatePresence initial={false}><ChangingPanel key={identity}>{children}</ChangingPanel></AnimatePresence></div>
}

export function FoldChevron(){
  return <svg className="fold-chevron" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4.25 6 7.75 9.5 4.25"/></svg>
}

// An intrinsic-height sheet enters normal flow once. Two opposite translations uncover its
// content without scaling the type. During exit it floats in its old slot as the rows move up.
function FoldedPaper({children}:{children:ReactNode}){
  const present=useIsPresent(),reduced=useReducedMotionPreference()
  const transition=reduced?{duration:0}:glide
  return <motion.div className="fold-viewport" data-leaving={!present || undefined} inert={!present}
    initial={reduced?false:'closed'} animate="open" exit="closed">
    <motion.div className="fold-mask" variants={{closed:{y:reduced?'0%':'-100%'},open:{y:'0%'}}} transition={transition}>
      <motion.div variants={{closed:{y:reduced?'0%':'100%',opacity:reduced?1:0},open:{y:'0%',opacity:1}}} transition={transition}>{children}</motion.div>
    </motion.div>
  </motion.div>
}
export function PaperFold({id,open,children}:{id:string;open:boolean;children:ReactNode}){
  const reduced=useReducedMotionPreference()
  return <motion.div id={id} className="fold-slot" layout={reduced?false:'position'} layoutDependency={open}>
    <AnimatePresence initial={false}>{open && <FoldedPaper key="paper">{children}</FoldedPaper>}</AnimatePresence></motion.div>
}
