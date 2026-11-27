import { useRef, type PointerEvent } from 'react'

export function DirectionalButton({ onOpen, lit, label }: {onOpen: () => void; lit: boolean; label: string}) {
  const mask = useRef<HTMLSpanElement>(null)
  function enter(event: PointerEvent<HTMLButtonElement>) {
    const button=event.currentTarget, layer=mask.current
    if(!layer) return
    if (!layer.getAnimations().length) {
      const rect=button.getBoundingClientRect()
      const dx=(event.clientX-rect.left)/rect.width-.5, dy=(event.clientY-rect.top)/rect.height-.5
      const horizontal=Math.abs(dx)>=Math.abs(dy)
      // Translate the ink and counter-translate the reversed label by the same
      // amount. The glyphs stay registered as the edge passes over them.
      button.dataset.aligning=''
      button.style.setProperty('--fill-x',horizontal?(dx<0?'-100%':'100%'):'0%')
      button.style.setProperty('--fill-y',horizontal?'0%':(dy<0?'-100%':'100%'))
      void getComputedStyle(layer.firstElementChild!).transform
      delete button.dataset.aligning
    }
    button.dataset.filled='true'
  }
  const content=<>{label} <span className="round-arrow">↗</span></>
  return <button id="stage-open" className="direction-button" data-lit={lit} onClick={onOpen}
    onPointerEnter={enter} onPointerLeave={event => { delete event.currentTarget.dataset.filled }}>
    <span className="button-label">{content}</span>
    <span ref={mask} aria-hidden="true" className="button-inverse"><span className="inverse-label">{content}</span></span>
  </button>
}
