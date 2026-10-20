// Explicit memory commands are parsed identically on iPhone and the server.
export function memoryRequest(text) {
  const value = String(text || '').trim();
  if (/(?:^|[\s,])не\s+запомни|не\s+(?:надо\s+)?запоминать|не\s+запоминай/i.test(value)) return null;
  const start = value.match(/^(?:(?:и|пожалуйста)[,\s]+)?запомни(?:[,\s]+пожалуйста)?(?:\s*[:,—-]\s*|\s+)([\s\S]+)$/i);
  const end = value.match(/^([\s\S]+?)[,;.!?\s—-]+запомни(?:[,\s]+(?:это|так|пожалуйста))*[.!?\s]*$/i);
  if (!start && !end) return null;
  const fact = (start?.[1] || end?.[1] || '').replace(/[,;\s—-]+$/, '').trim();
  if (!fact || /^(это|так|всё|все)$/i.test(fact)) return { fact: null };
  return { fact: fact.slice(0, 380) };
}
export function memoryDay(at = Date.now(), timezone = 'UTC') {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at)); }
  catch { return new Date(at).toISOString().slice(0, 10); }
}
export const noteDate = note => String(note).match(/^\[На (\d{4}-\d{2}-\d{2})\] /)?.[1] || null;
export function scopedNote(fact, at = Date.now(), timezone = 'UTC') {
  if (!/сегодня|завтра/i.test(fact)) return fact;
  let day = memoryDay(at, timezone);
  if (/завтра/i.test(fact) && !/сегодня/i.test(fact)) day = new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  return `[На ${day}] ${fact.replace(/сегодня|завтра/gi, 'в этот день')}`.slice(0, 400);
}
export function activeMemory(notes, day) {
  return (Array.isArray(notes) ? notes : []).filter(n => typeof n === 'string').slice(0, 20)
    .map(n => n.slice(0, 400)).filter(n => !noteDate(n) || noteDate(n) === day);
}

// Preserve all chats locally; retrieve a bounded selection of the user's own words.
// Never promote model-written explanations into remembered user facts.
export function recallChats(book, currentId, message, at = Date.now(), timezone = 'UTC') {
  const day = memoryDay(at, timezone);
  const words = new Set(String(message).toLowerCase().replace(/ё/g, 'е').match(/[а-яa-z0-9]{4,}/g) || []);
  const candidates = (book?.threads || []).filter(t => t.id !== currentId).flatMap(t => t.messages || [])
    .filter(m => m.role === 'user' && !m.recallExcluded && typeof m.content === 'string' && Number.isFinite(m.at))
    .filter(m => activeMemory([scopedNote(m.content, m.at, timezone)], day).length)
    .map(m => ({ m, score: [...words].filter(w => m.content.toLowerCase().replace(/ё/g, 'е').includes(w)).length }))
    .sort((a, b) => b.m.at - a.m.at);
  const relevant = candidates.filter(c => c.score > 0).sort((a,b) => b.score - a.score || b.m.at - a.m.at).slice(0, 4);
  const selected = [...new Set([...candidates.slice(0, 6), ...relevant])].sort((a,b) => a.m.at - b.m.at);
  let budget = 3200;
  return selected.flatMap(({m}) => {
    // Make yesterday's “tomorrow” unambiguous in a new conversation today.
    const content = scopedNote(m.content, m.at, timezone).slice(0, Math.min(400, budget)); budget -= content.length;
    return content ? [{ date: memoryDay(m.at, timezone), content }] : [];
  });
}
