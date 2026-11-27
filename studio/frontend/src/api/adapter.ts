import type { DiscoveryItem } from '../entrances/types'
import type { Entry, EntrySummary, Reply, Session } from '../types/archive'

export interface Hit {entry_id:string; para_id:string; seq_no:number; text_raw:string}
export interface Photo {photo_id:string; width:number; height:number; links:{entry_id:string}[]}
export interface Album {set_id:string; title_raw:string; date_hint:string; set_note_raw?:string; set_note_written_at?:string; items:{photo_id:string}[]}
export type AlbumSummary=Omit<Album,'items'> & {first_photo_id:string|null;photo_count:number}
export interface Queue {
  entries:(EntrySummary & {has_quote:number; has_ai:number; confirmed_none:number})[]
  dismissed:{entry_id:string; dismiss_kind:string}[]
  candidates:{entry_id:string; quote_id:string; quote_text:string}[]
}
export interface Simulation {count:number; entries:Record<string,number>; quotes:Record<string,number>}
export interface ReadingPrefs {font:number; resume:boolean}
export const defaultReadingPrefs:ReadingPrefs={font:0,resume:true}
export function validReadingPrefs(p:ReadingPrefs){
  return Object.keys(p).length===2 && Number.isInteger(p.font) && p.font>=0 && p.font<=3 &&
    typeof p.resume==='boolean'
}
export type ImportMode = 'single'|'new'|'existing'
export interface PhotoMetadata {key:string; mode:ImportMode; precision:string; date?:string; title?:string; note?:string; set_id?:string}
export type ArchiveKind='entry'|'photo'|'photo_set'
export interface ArchiveItem {kind:ArchiveKind;id:string;title?:string|null}
export interface BinItem extends ArchiveItem {deleted_at:string;purging:number;protected_history?:number}
export type ArchiveOperation={action:'move';item:ArchiveItem}|{action:'restore'|'purge';item:BinItem}
export type OnArchiveChange = (clueId?:string)=>void
export interface DataAdapter {
  moveBatch(items:ArchiveItem[]):Promise<{moved:number}>
  restoreAll():Promise<{restored:number;skipped:number}>
  purgeAll():Promise<{purged:number}>
  trash():Promise<BinItem[]>
  changeArchive(op:ArchiveOperation):Promise<{id:string}>
  prefs():Promise<ReadingPrefs>
  savePrefs(prefs:ReadingPrefs):Promise<ReadingPrefs>
  importPhotos(files:File[], metadata:PhotoMetadata):Promise<{photo_ids:string[];set_id:string|null}>
  resetFixture():Promise<void>
  session(): Promise<Session>
  discovery(): Promise<DiscoveryItem[]>
  entryCount(): Promise<number>
  entries(): Promise<EntrySummary[]>
  entry(id: string): Promise<Entry>
  reply(id: string): Promise<Reply>
  image(id: string): string
  search(q:string):Promise<Hit[]>
  albums():Promise<AlbumSummary[]>
  album(id:string):Promise<Album>
  photo(id:string):Promise<Photo>
  orphans():Promise<{response_id:string;title_raw:string;note:string}[]>
  queue():Promise<Queue>
  simulate(mode:string):Promise<Simulation>
  save(payload:Record<string,unknown>, key:string):Promise<{id:string}>
}
