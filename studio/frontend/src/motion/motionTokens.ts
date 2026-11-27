export const PAPER_EASE = [0.22, 0.72, 0.24, 1] as const
export const EXIT_EASE = [0.4, 0, 0.7, 1] as const
export const TACTILE_SPRING = {type:'spring', stiffness:420, damping:36, mass:0.85} as const
export const enterPaper = {duration:.22, ease:PAPER_EASE}
export const exitPaper = {duration:.16, ease:EXIT_EASE}
export const paperCurve = 'cubic-bezier('+PAPER_EASE.join(',')+')'
export const exitCurve = 'cubic-bezier('+EXIT_EASE.join(',')+')'
