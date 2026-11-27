import {createPortal} from 'react-dom'
import {useEffect} from 'react'
import {AnimatePresence,motion} from 'framer-motion'
import {useReducedMotionPreference} from './entrances/scheme-a/paperMotion'

export function SaveToast({notice,close,host}:{host?:HTMLElement|null;notice?:{message:string;key:number};close:()=>void}) {
  const reduced=useReducedMotionPreference()
  useEffect(()=>{
    if(!notice)return
    const timer=window.setTimeout(close,2200)
    return ()=>clearTimeout(timer)
  },[notice,close])
  const toast=<AnimatePresence>{notice && <motion.div className="save-toast" role="status" key="confirmation"
    initial={{opacity:0,y:reduced?0:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduced?0:3}}
    transition={{duration:reduced?0:.18}}>
    <span key={notice.key} className="toast-check" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m2.5 8 3.75 3.75 7.25-7.5"/></svg></span><span>{notice.message}</span>
    <button aria-label="关闭确认提示" onClick={close}>×</button>
  </motion.div>}</AnimatePresence>
  return host?createPortal(toast,host):toast
}
