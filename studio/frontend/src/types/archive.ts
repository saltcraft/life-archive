export type Scope = 'fixture' | 'personal'
export interface Session { scope: Scope; writable: boolean; label: string | null; session_token: string; allow_scope_switch: boolean }
export interface EntrySummary { entry_id: string; title_raw?: string; entry_date?:string; backfill_note?:string; written_time_raw?:string }
export interface Entry extends EntrySummary {
  title_raw: string; entry_date: string
  paragraphs: { para_id: string; text_raw: string }[]
  photos: { photo_id: string; placement: string; anchor_para_id?:string; width: number; height: number }[]
  links: { link_status: string; response_id: string | null; note?: string | null }[]
}
export type Run = ['text' | 'bold' | 'tab' | 'break' | 'rule', string]
export interface Block {
  type: 'paragraph' | 'bullet' | 'user_followup' | 'table' | 'rule' | 'gap_notice'
  text?: string; runs?: Run[]; rows?: string[][]; cells?: Block[][][]; followup_id?: string
}
export interface Reply { response_id: string; title_raw?: string; blocks: Block[] }
