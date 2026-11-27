/** Display and new-input boundary only. Preserve IDs, internal blanks and source strings. */
export function trimTrailingBlankParagraphs<T extends string | {text_raw:string}>(rows:T[]):T[]{
  let end=rows.length
  while(end>1){
    const row=rows[end-1]
    if((typeof row==='string'?row:row.text_raw).trim())break
    end--
  }
  return end===rows.length?rows:rows.slice(0,end)
}
