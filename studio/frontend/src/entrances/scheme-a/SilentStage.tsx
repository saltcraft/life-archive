import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, useIsPresent, type Variants } from 'framer-motion'
import type { DiscoveryItem, EntranceProps } from '../types'
import { displayDate } from '../../core/displayDate'
import { MagneticAnchor } from './MagneticAnchor'
import {useQuoteTurn,quoteClass} from './quoteTurn'
import { DirectionalButton } from './DirectionalButton'

import {PAPER_EASE,EXIT_EASE} from '../../motion/motionTokens'

const turnClue: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: 18 * direction }),
  still: { opacity: 1, y: 0, transition: { duration: .22, ease:PAPER_EASE } },
  leave: (direction: number) => ({ opacity: 0, y: -14 * direction, transition: { duration: .15, ease:EXIT_EASE } }),
}
const stillClue: Variants = {
  enter: { opacity: 1, y: 0 }, still: { opacity: 1, y: 0 }, leave: { opacity: 1, y: 0, transition: { duration: 0 } },
}

type Quote = Extract<DiscoveryItem,{kind:'quote'}>
type Photo = Extract<DiscoveryItem,{kind:'photo'}>

function QuoteSpread({item,direction,loadEntry,open,reduced,visible}:{
  item:Quote; direction:number; loadEntry:EntranceProps['loadEntry']; open:EntranceProps['onOpenEntry']
  reduced:boolean; visible:boolean
}) {
  const [hot,setHot]=useState(false),present=useIsPresent()
  const {copy,shown,pulse}=useQuoteTurn(item,direction,visible && present && !reduced)
  const read=()=>open(shown.entryId,{fromQuoteId:shown.quoteId})
  return <motion.div className="stage-spread quote-spread" data-clue-id={shown.quoteId}
    custom={direction} variants={reduced?stillClue:turnClue} initial="enter" animate="still" exit="leave">
    <div className="cover-copy" ref={copy}>
      <div className="clue-words">
        <div className="quote-block"><span aria-hidden="true" className="quotation">“</span>
          <div className="quote-lines"><span className="quote-measure" aria-hidden="true"/>
            <button id="stage-clue" onClick={read} className={quoteClass(shown.quoteText)}>{shown.quoteText}</button></div></div>
        <p className="clue-date"><i/><span className="date-ink">{displayDate(shown.entryDate)}</span></p>
      </div>
      <div className="stage-action"><DirectionalButton lit={hot} onOpen={read} label="阅读全文"/></div>
    </div>
    <div className="cover-object">
      <i className="sage-field" aria-hidden="true"/>
      <div className="book-binding"><MagneticAnchor item={shown} loadEntry={loadEntry} setActive={setHot} pulse={pulse} visible={visible && present} reduced={reduced} onOpen={read}/>
      </div>
    </div>
  </motion.div>
}

function PhotoSpread({ item, open }: { item: Photo; open: () => void }) {
  return <>
    <div className="photo-board" style={{ '--image-ratio': item.width / item.height } as CSSProperties}>
      <button id="stage-clue" className="photo-mat" data-stack={item.setId ? 'set' : 'single'} onClick={open}>
        <span className="photo-inner"><img src={item.imageUrl} width={item.width} height={item.height} alt="舞台照片"/></span>
      </button>
    </div>
    <div className="stage-action"><DirectionalButton lit={false} onOpen={open} label={item.setId ? '浏览照片集' : '查看照片'}/></div>
  </>
}

export function SilentStage({ items, currentIndex, onStep, onOpenEntry, onOpenPhoto, loadEntry, visible, reducedMotion }: EntranceProps) {
  const item = items[currentIndex]
  const [direction, setDirection] = useState(1)
  const stage = useRef<HTMLElement>(null)
  const step = useCallback((d: -1 | 1) => { setDirection(d);onStep(d) }, [onStep])
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const inactive = () => element.closest('[inert]') || document.querySelector('dialog[open]')
    let lastWheel = -Infinity, lastStep = -Infinity, distance = 0
    function wheel(e: WheelEvent) {
      if (inactive() || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      const now = performance.now()
      if (now - lastWheel > 160) distance = 0
      lastWheel = now
      if (now-lastStep<135) return
      distance += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1)
      if (Math.abs(distance) >= 12) { step(distance > 0 ? 1 : -1); distance = 0; lastStep = now }
    }
    function key(e: KeyboardEvent) {
      if (inactive() || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(e.key === 'ArrowUp' ? -1 : 1) }
    }
    element.addEventListener('wheel', wheel, { passive: true })
    window.addEventListener('keydown', key)
    return () => { element.removeEventListener('wheel', wheel); window.removeEventListener('keydown', key) }
  }, [step])
  if (!item) return null
  return <main ref={stage} className="stage cover-stage">
    <div className="stage-surround" aria-hidden="true"/>
    <div className="stage-gallery">
      <AnimatePresence initial={false} mode="wait" custom={direction}>
        {item.kind==='quote'?<QuoteSpread key="book" item={item} direction={direction}
          open={onOpenEntry} loadEntry={loadEntry} reduced={reducedMotion} visible={visible}/>:
          <motion.div key={item.photoId} className="stage-spread photo-spread" data-clue-id={item.photoId}
            custom={direction} variants={reducedMotion?stillClue:turnClue} initial="enter" animate="still" exit="leave">
            <PhotoSpread item={item} open={()=>onOpenPhoto(item.photoId,item.setId)}/>
          </motion.div>}
      </AnimatePresence>
    </div>
    <div className="stage-footer"><span className="folio"><span className="folio-current"><AnimatePresence initial={false} mode="popLayout"><motion.span key={currentIndex} exit={{opacity:0}} initial={reducedMotion?false:{y:direction*5,opacity:.4}} animate={{y:0,opacity:1}} transition={{duration:reducedMotion?0:.16,ease:PAPER_EASE}}>{String(currentIndex+1).padStart(2,'0')}</motion.span></AnimatePresence></span> <i>/</i> {String(items.length).padStart(2,'0')}</span>
      <div className="steps"><button onClick={() => step(-1)} aria-label="上一条">↑</button><button onClick={() => step(1)} aria-label="下一条">↓</button></div>
    </div>
  </main>
}
