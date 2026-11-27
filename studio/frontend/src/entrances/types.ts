export type DiscoveryItem =
  | { kind: 'quote'; quoteId: string; entryId: string; quoteText: string; entryDate: string
      paraId: string; charEnd: number; entryCount: number; linked: boolean }
  | { kind: 'photo'; photoId: string; setId?: string | null; imageUrl: string; width: number; height: number; hasInnerMargin?: boolean; dateHint?: string | null }

export interface EntranceProps {
  loadEntry: import('../api/adapter').DataAdapter['entry']
  visible: boolean
  items: DiscoveryItem[]
  currentIndex: number
  onStep: (delta: -1 | 1) => void
  onOpenEntry: (entryId: string, opts?: { fromQuoteId?: string }) => void
  onOpenPhoto: (photoId: string, setId?: string | null) => void
  onOpenLookup: () => void
  reducedMotion: boolean
}
