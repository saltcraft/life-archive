import { useSyncExternalStore } from 'react'

const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
const subscribe = (notify: () => void) => {
  preference.addEventListener('change', notify)
  return () => preference.removeEventListener('change', notify)
}
export const useReducedMotionPreference = () => useSyncExternalStore(subscribe, () => preference.matches)

function finishOnInput(animations: Animation[], cleanup: () => void, interrupt: (finish: () => void) => void) {
  const input = new AbortController()
  let ended = false
  function finish() {
    if (ended) return
    ended = true
    input.abort()
    for (const animation of animations) animation.cancel()
    cleanup()
  }
  function takeInput() {
    input.abort()
    interrupt(finish)
  }
  for (const event of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'click', 'keydown']) {
    window.addEventListener(event, takeInput, { capture: true, passive: true, signal: input.signal })
  }
  Promise.all(animations.map(animation => animation.finished)).then(finish, finish)
  return finish
}

const openingKey = 'la.scheme-a.cover-v2.opened'
let openedHere = false
export function openCover(stage: HTMLElement, reduced: boolean) {
  if (openedHere) return
  openedHere = true
  try {
    if (sessionStorage.getItem(openingKey)) return
    sessionStorage.setItem(openingKey, '1')
  } catch { /* The in-memory flag still covers this document. */ }
  if (reduced) return
  stage.dataset.opening = 'true'
  const animations: Animation[] = []
  function reveal(target: string | Element, start: Keyframe, end: Keyframe, delay: number, duration: number) {
    const element = typeof target === 'string' ? stage.querySelector(target) : target
    if (element) animations.push(element.animate([start, end], {
      duration, delay, easing: 'cubic-bezier(.22,.76,.24,1)', fill: 'backwards',
    }))
  }
  reveal('.sage-field', {transform:'scaleX(.48)', opacity:.2}, {transform:'none', opacity:1}, 0, 890)
  reveal('.sage-plinth', {transform:'scaleX(.65)', opacity:.25}, {transform:'none', opacity:1}, 60, 950)
  reveal('.binding-rule', {transform:'scaleX(0)'}, {transform:'none'}, 130, 1000)
  // Fan out from a common spine, without replacing Motion's magnetic transform.
  stage.querySelectorAll('.leaf').forEach((leaf,i) => {
    const restAngle = getComputedStyle(leaf).rotate
    reveal(leaf, {translate:'-12px 14px', rotate:'-3deg', opacity:0},
      {translate:'0px 0px', rotate:restAngle, opacity:1}, 250 + 90*i, 920)
  })
  reveal('.photo-board', {translate:'0 12px', opacity:.1}, {translate:'0 0', opacity:1}, 250, 1150)
  reveal('.quote-block', {translate:'0 8px', opacity:.05}, {translate:'0 0', opacity:1}, 680, 1040)
  reveal('.clue-date', {opacity:0}, {opacity:1}, 950, 880)
  reveal('.stage-action', {opacity:.02}, {opacity:1}, 1100, 900)
  const ready = () => { delete stage.dataset.opening }
  return finishOnInput(animations, ready, () => {
    ready()
    for (const animation of animations) {
      const end = Number(animation.effect?.getComputedTiming().endTime ?? 0)
      const remaining = end - Number(animation.currentTime ?? 0)
      if (remaining > 0) animation.updatePlaybackRate(Math.max(1,remaining/75))
    }
  })
}

export function turnPaper(studio: HTMLElement, way: 'enter' | 'return', onEnd: () => void) {
  const stage = studio.querySelector<HTMLElement>('.cover-stage')
  const book = stage?.querySelector<HTMLElement>('.anchor')
  const pages = book?.querySelector<HTMLElement>('.anchor-stack')
  const reader = studio.querySelector<HTMLElement>('#reader')
  const content = reader?.querySelector<HTMLElement>('.reading-content')
  const edge = reader?.querySelector<HTMLElement>('.reader-edge')
  if (!stage || !book || !pages || !reader || !content || !edge) { onEnd(); return }

  const cover = book.getBoundingClientRect(), line = edge.getBoundingClientRect()
  const atLine = `translate(${line.x-cover.x}px,${line.y-cover.y}px) scale(${line.width/cover.width},${line.height/cover.height})`
  const moving = document.createElement('div')
  moving.className = 'paper-transition'
  moving.setAttribute('aria-hidden','true')
  Object.assign(moving.style, { left:cover.x+'px', top:cover.y+'px', width:cover.width+'px', height:cover.height+'px' })
  const copy = pages.cloneNode(true) as HTMLElement
  copy.style.transform = getComputedStyle(pages).transform
  Array.from(copy.children).forEach((leaf, i) => {
    (leaf as HTMLElement).style.transform = getComputedStyle(pages.children[i]).transform
  })
  const spine = document.createElement('i')
  spine.className = 'turn-spine'
  moving.append(copy, spine)
  document.body.append(moving)
  studio.dataset.paperTurn = way

  const timing: KeyframeAnimationOptions = { duration:way === 'enter' ? 700 : 550, direction:way === 'enter' ? 'normal' : 'reverse', fill:'both' }
  const travel = moving.animate([
    {transform:'none', offset:0}, {transform:'none', offset:.09, easing:'cubic-bezier(.42,.04,.2,1)'},
    {transform:atLine, offset:.94}, {transform:atLine, offset:1},
  ], timing)
  const animations = [travel,
    stage.animate([{opacity:1}, {opacity:0, offset:.4}, {opacity:0}], timing),
    reader.animate([{opacity:0}, {opacity:1, offset:.58}, {opacity:1}], timing),
    // Keep paragraph coordinates final from the first frame, including on resumed reads.
    content.animate([{opacity:0}, {opacity:0, offset:.4, easing:'ease-out'}, {opacity:1}], timing),
    spine.animate([{opacity:0}, {opacity:0, offset:.5}, {opacity:1, offset:.92}, {opacity:1}], timing),
  ]
  let settle: Animation | undefined
  const finish = finishOnInput(animations, () => {
    moving.remove()
    delete studio.dataset.paperTurn
    onEnd()
  }, release => {
    const destination = way === 'enter' ? content : stage
    const opacity = Number(getComputedStyle(destination).opacity)
    release()
    if (opacity < 1 && !preference.matches) {
      settle = destination.animate([{opacity:Math.max(.78,opacity)}, {opacity:1}], {duration:75,easing:'ease-out'})
    }
  })
  return () => { finish(); settle?.cancel() }
}
