import { memoryRequest } from "./assistant-memory.js";
// Device-local conversations and explicit memory, isolated by signed-in account.
export const GREETINGS = [
  'Ну что, начнём{n}?', 'Соберём день{n}?', 'Что сегодня главное{n}?',
  'Давай разложим всё по полочкам{n}.', 'С чего хочешь начать{n}?',
  'Разберёмся с делами{n}?', 'Освободим голову{n}?',
  'Какой план на сегодня{n}?', 'Выберем следующий шаг{n}?', 'Я рядом{n}. Что обсудим?',
];
export const greetingText = (index, name = '') => GREETINGS[((index || 0) % 10 + 10) % 10].replace('{n}', name ? ', ' + name : '');
const key = id => 'mark:assistant-chats:v1:' + id;
export function newThread(index = 0, now = Date.now()) {
  return { id: crypto.randomUUID(), title: 'Новый чат', at: now, updatedAt: now, greeting: index % 10, messages: [], input: '' };
}
export function readChats(storage, userId, now = Date.now()) {
  if (!userId) return null;
  let saved;
  try { saved = JSON.parse(storage.getItem(key(userId)) || 'null'); } catch { /* recover below */ }
  if (saved?.version === 1 && Array.isArray(saved.threads)) {
    const threads = saved.threads.filter(t => typeof t?.id === 'string' && Array.isArray(t.messages));
    if (threads.length) return { version: 1, threads, activeId: threads.some(t => t.id === saved.activeId) ? saved.activeId : threads[0].id,
      nextGreeting: Number(saved.nextGreeting) || 0, memory: Array.isArray(saved.memory) ? saved.memory.filter(x => typeof x === 'string').slice(0, 20) : [] };
  }
  const thread = newThread(0, now);
  try {
    const old = JSON.parse(storage.getItem('mark:assistant:' + userId) || '[]');
    if (Array.isArray(old)) thread.messages = old.filter(m => m && ['user', 'assistant'].includes(m.role));
  } catch { /* a fresh conversation */ }
  if (thread.messages.length) thread.title = thread.messages.find(m => m.role === 'user')?.content?.slice(0, 64) || 'Предыдущий диалог';
  return { version: 1, threads: [thread], activeId: thread.id, nextGreeting: 1, memory: [] };
}
export function writeChats(storage, userId, data) {
  if (!userId || !data) return false;
  try { storage.setItem(key(userId), JSON.stringify(data)); return true; } catch { return false; }
}
export function explicitMemory(text) {
  return memoryRequest(text)?.fact || null;
}
export function appendMemory(memory, fact) {
  if (!fact || memory.includes(fact)) return memory;
  // Never silently evict a preference. The editor can remove outdated notes.
  if (memory.length >= 20) return null;
  return [...memory, fact];
}

export function beginConversation(book) {
  if (!book) return null;
  // Empty visits are not useful history; keep any conversation or unsent draft.
  book.threads = book.threads.filter(t => t.id !== book.activeId || t.messages.length || t.input);
  const t = newThread(book.nextGreeting++);
  book.threads.unshift(t); book.activeId = t.id;
  return t;
}
