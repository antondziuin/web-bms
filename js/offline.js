/* Offline mode (opt-in): service worker registration, the suggestion banner and the install prompt. */
import { storageGet, storageSet, errMsg } from './util.js';
import { t } from './i18n.js';

const KEY = 'ui:offline'; // '1' enabled, '0' declined/disabled, absent = not asked yet
const $ = sel => document.querySelector(sel);

export function offlineSupported(){
  return 'serviceWorker' in navigator && window.isSecureContext;
}

async function register(){
  const reg = await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  return reg;
}
async function unregister(){
  for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
  if ('caches' in window) for (const key of await caches.keys()) if (key.startsWith('web-bms-')) await caches.delete(key);
}

export function initOffline(){
  const banner = $('#offlineBanner'), bannerText = $('#offlineBannerText');
  const btnEnable = $('#offlineEnable'), btnLater = $('#offlineLater'), btnInstallBanner = $('#offlineInstallBanner');
  const sw = $('#offlineSw'), chk = $('#offlineChk');
  const installRow = $('#installRow'), installBtn = $('#installBtn');
  let installPrompt = null;
  let doneTimer = null;

  function showInstall(){
    installRow.hidden = !installPrompt;
    btnInstallBanner.hidden = !installPrompt || !banner.classList.contains('done');
  }
  async function install(){
    if (!installPrompt) return;
    const p = installPrompt; installPrompt = null; showInstall();
    try{ await p.prompt(); }catch{}
  }
  // why: Chrome показывает своё предложение установки; перехватываем, чтобы предложить его в подходящий момент
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; showInstall(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; showInstall(); });
  installBtn.addEventListener('click', install);
  btnInstallBanner.addEventListener('click', install);

  if (!offlineSupported()) return;
  sw.hidden = false;
  const pref = storageGet(KEY, null);
  chk.checked = pref === '1';

  async function enable(fromBanner){
    try{
      await register();
      storageSet(KEY, '1');
      chk.checked = true;
      if (fromBanner){
        banner.classList.add('done');
        bannerText.dataset.i18n = 'off.ready';
        bannerText.textContent = t('off.ready');
        btnEnable.hidden = true; btnLater.hidden = true;
        showInstall();
        clearTimeout(doneTimer);
        doneTimer = setTimeout(() => { if (!installPrompt) banner.hidden = true; }, 6000);
      }
    }catch(err){
      chk.checked = false;
      bannerText.textContent = t('off.failed', { msg: errMsg(err) });
      if (!fromBanner) alert(t('off.failed', { msg: errMsg(err) }));
    }
  }

  btnEnable.addEventListener('click', () => enable(true));
  btnLater.addEventListener('click', () => { storageSet(KEY, '0'); banner.hidden = true; });
  chk.addEventListener('change', async () => {
    banner.hidden = true;
    if (chk.checked) await enable(false);
    else { storageSet(KEY, '0'); await unregister().catch(()=>{}); }
  });

  if (pref === '1') register().catch(err => console.warn('service worker', err)); // keeps the cached copy fresh
  else if (pref === null) banner.hidden = false;
}
