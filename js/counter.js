/* Visitor counter (Stats4U). Loaded only online and not on a local dev/test server; hidden offline,
   so the installed app working without network shows nothing. Statistics: https://www.stats4u.net/live/7078659379 */
const SRC = 'https://www.stats4u.net/s4u.js';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', ''];

export function initCounter(){
  const box = document.getElementById('counter');
  if (!box || LOCAL_HOSTS.includes(location.hostname)) return;
  let state = 'idle'; // idle → loading → loaded | failed
  const sync = () => { box.hidden = state !== 'loaded' || !navigator.onLine; };
  function load(){
    if (state !== 'idle' || !navigator.onLine) return;
    state = 'loading';
    const s = document.createElement('script');
    s.src = SRC; s.async = true;
    s.dataset.id = '7078659379'; s.dataset.style = '904';
    // why: если скрипт не загрузился (сеть пропала на полпути), сбрасываем — попробуем снова при online
    s.onload = () => { state = 'loaded'; sync(); };
    s.onerror = () => { s.remove(); state = 'idle'; sync(); };
    box.appendChild(s); // the widget renders next to its own <script>, i.e. inside the footer
  }
  window.addEventListener('online', () => { load(); sync(); });
  window.addEventListener('offline', sync);
  load();
}
