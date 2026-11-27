import {validReadingPrefs} from './adapter'
import type { DataAdapter, ArchiveItem, ArchiveOperation, BinItem, Album, AlbumSummary, Hit, Queue, Photo, Simulation, ReadingPrefs, PhotoMetadata } from './adapter'
import type { DiscoveryItem } from '../entrances/types'
import type { Entry, EntrySummary, Reply, Session } from '../types/archive'

type WireClue =
  | { kind: 'quote'; entry_id: string; quote_id: string; quote_text: string; entry_date: string
      para_id: string; char_end: number; entry_count: number; linked: boolean | number }
  | { kind: 'photo'; photo_id: string; set_id: string | null; width: number; height: number; has_inner_margin: number; taken_date_raw: string | null }

export class HttpAdapter implements DataAdapter {
  private base = new URL('./', location.href)
  private token = ''
  private fixture = false
  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const result = await fetch(new URL(path, this.base), { cache: 'no-store', ...init })
    if (!result.ok) throw new Error('读取失败')
    return result.json() as Promise<T>
  }
  async session() {
    const session = await this.json<Session>('session')
    this.fixture = session.scope === 'fixture'
    this.token = session.session_token
    return session
  }
  private post<T>(path:string,payload:unknown){
    return this.json<T>(path,{method:'POST',headers:{'Content-Type':'application/json','X-LA-Session-Token':this.token},body:JSON.stringify(payload)})
  }
  moveBatch(items:ArchiveItem[]){return this.post<{moved:number}>('trash/move-batch',{items:items.map(({kind,id})=>({kind,id}))})}
  restoreAll(){return this.post<{restored:number;skipped:number}>('trash/restore-all',{confirm:'restore-all'})}
  purgeAll(){return this.post<{purged:number}>('trash/purge-all',{confirm:'purge-all'})}
  trash(){return this.post<BinItem[]>('trash/list',{})}
  changeArchive(op:ArchiveOperation){
    const {id,kind}=op.item
    return this.post<{id:string}>('trash/'+op.action,{id,kind,...(op.action==='move'?{}:{deleted_at:op.item.deleted_at}),
      ...(op.action==='purge'?{confirm:'purge'}:{})})
  }
  async prefs():Promise<ReadingPrefs> {
    const prefs=await this.json<ReadingPrefs>('prefs')
    if(!validReadingPrefs(prefs))throw Error('阅读设置无效')
    return prefs
  }
  async savePrefs(prefs:ReadingPrefs) {
    if(!validReadingPrefs(prefs))throw Error('阅读设置无效')
    return this.json<ReadingPrefs>('prefs',{method:'POST',headers:{'Content-Type':'application/json','X-LA-Session-Token':this.token},body:JSON.stringify(prefs)})
  }
  importPhotos(files:File[], metadata:PhotoMetadata) {
    const body=new FormData()
    body.append('metadata',JSON.stringify(metadata))
    for(const file of files) body.append('files',file)
    return this.json<{photo_ids:string[];set_id:string|null}>('photos/import',{method:'POST',headers:{'X-LA-Session-Token':this.token},body})
  }
  async resetFixture() {
    const result=await this.json<{session_token:string}>('fixture/reset',{method:'POST',
      headers:{'Content-Type':'application/json','X-LA-Session-Token':this.token},body:JSON.stringify({confirm:'reset-fixture'})})
    this.token=result.session_token
  }
  entryCount() { return this.json<number>('entry-count') }
  entries() { return this.json<EntrySummary[]>('catalog') }
  entry(id: string) { return this.json<Entry>('entries/' + encodeURIComponent(id)) }
  reply(id: string) { return this.json<Reply>('responses/' + encodeURIComponent(id)) }
  image(id: string) { return new URL('images/' + encodeURIComponent(id), this.base).href }
  async discovery(): Promise<DiscoveryItem[]> {
    const rows = await this.json<WireClue[]>('discovery')
    const quotes: DiscoveryItem[] = [], photos: DiscoveryItem[] = []
    for (const r of rows) {
      if (r.kind === 'quote') quotes.push({kind: 'quote', quoteId: r.quote_id, entryId: r.entry_id, quoteText: r.quote_text,
        entryDate: r.entry_date, paraId:r.para_id, charEnd:r.char_end, entryCount:r.entry_count, linked:!!r.linked})
      else photos.push({kind: 'photo', photoId: r.photo_id, setId: r.set_id, width: r.width, height: r.height,
        hasInnerMargin: !!r.has_inner_margin, imageUrl: this.image(r.photo_id), dateHint:r.taken_date_raw})
    }
    const clues: DiscoveryItem[] = []
    for (let i = 0; i < Math.max(quotes.length, photos.length); i++) {
      if (quotes[i]) clues.push(quotes[i])
      if (photos[i]) clues.push(photos[i])
    }
    return clues
  }
  search(q:string) {return this.json<Hit[]>('search?q='+encodeURIComponent(q))}
  albums() {return this.json<AlbumSummary[]>('sets')}
  album(id:string) {return this.json<Album>('sets/'+encodeURIComponent(id))}
  photo(id:string) {return this.json<Photo>('photos/'+encodeURIComponent(id))}
  orphans(){return this.json<{response_id:string;title_raw:string;note:string}[]>('orphan-responses')}
  queue() {return this.json<Queue>('curation')}
  simulate(mode:string) {return this.json<Simulation>('simulate?mode='+encodeURIComponent(mode))}
  save(payload:Record<string,unknown>, key:string) {
    return this.json<{id:string}>(payload.kind==='entry'?'imports':'curation',{method:'POST',
      headers:{'Content-Type':'application/json','X-LA-Session-Token':this.token},
      body:JSON.stringify({idempotency_key:key,payload:this.fixture?{...payload,label:'虚构测试资料'}:payload})})
  }
}
