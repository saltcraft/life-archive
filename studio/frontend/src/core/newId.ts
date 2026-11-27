export function newId(): string {
  const crypto = globalThis.crypto
  if (crypto?.randomUUID) return crypto.randomUUID()
  if (crypto?.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, b=>b.toString(16).padStart(2,'0')).join('')
  }
  return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2)
}
