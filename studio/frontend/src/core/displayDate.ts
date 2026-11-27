/** Format complete entry dates at the point of display. Keep any original annotation verbatim. */
export function displayDate(raw:string) {
  const parts=/^(\d{4})(?:年(\d{1,2})月(\d{1,2})日|[-/.](\d{1,2})[-/.](\d{1,2}))(\s*(?:[（(].*)?)$/u.exec(raw)
  if(!parts) return raw
  const [,year,cm,cd,nm,nd,note]=parts
  const month=(cm??nm).padStart(2,'0'), day=(cd??nd).padStart(2,'0')
  const iso=year+'-'+month+'-'+day
  const date=new Date(iso+'T00:00:00Z')
  if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==iso) return raw
  return year+' · '+month+' · '+day+note
}
