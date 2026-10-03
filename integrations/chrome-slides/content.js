// Glanceline für Google Slides – läuft im Fenster „Vortragsnotizen“ (Referentenansicht, Taste S beim Präsentieren).
// Liest Folie und Notizen und gibt sie an den Service Worker weiter, der sie an Glanceline schickt.
(() => {
  'use strict';
  if (window.glancelineSlides) return;
  window.glancelineSlides = true;

  const NOTES = '.punch-viewer-speakernotes-text-body';
  const HEADER = '.punch-viewer-speakernotes-text-header'; // „Folie 3 von 12“ / „Slide 3 of 12“
  let last = '';
  let active = false;

  const send = (data) => {
    try {
      chrome.runtime.sendMessage({ type: 'slides', data });
    } catch {
      // Erweiterung neu geladen – diese Seite ist verwaist
    }
  };

  // „Vortragenden-Ansicht - Mein Vortrag - Google Präsentationen“ → „Mein Vortrag“
  function presentationTitle() {
    let title = '';
    try {
      title = window.opener ? window.opener.document.title : '';
    } catch {
      title = '';
    }
    const parts = (title || document.title).split(' - ');
    if (!title && parts.length >= 3) parts.shift(); // Fenstername davor
    if (parts.length >= 2) parts.pop(); // „Google Präsentationen“ / „Google Slides“
    return parts.join(' - ').trim();
  }

  function read() {
    const body = document.querySelector(NOTES);
    if (!body) return null;
    const nums = ((document.querySelector(HEADER) || {}).textContent || '').match(/\d+/g) || [];
    return {
      running: true,
      slide: Number(nums[0]) || 0,
      total: Number(nums[nums.length - 1]) || 0,
      // Weiche Zeilenumbrüche (Umschalt+Enter) stehen in dieser Ansicht als U+FFFD bzw. U+000B im Text
      notes: body.innerText.replace(/[\u000b�]/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
      presentation: presentationTitle(),
    };
  }

  function check(force) {
    const data = read();
    if (!data) return;
    active = true;
    const key = JSON.stringify(data);
    if (key !== last || force) {
      last = key;
      send(data);
    }
  }

  let timer = 0;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => check(false), 120);
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });

  // Lebenszeichen: Glanceline schaltet zurück, wenn die Meldungen ausbleiben
  setInterval(() => check(true), 3000);
  check(true);

  window.addEventListener('pagehide', () => {
    if (active) send({ running: false });
  });
})();
