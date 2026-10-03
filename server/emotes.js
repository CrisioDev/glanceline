'use strict';

// Lädt Drittanbieter-Emotes (7TV, BTTV, FFZ) für einen Twitch-Kanal – getrennt nach Quelle.
// Emote: { id?, n, p, u: [klein, mittel, groß], r?: Seitenverhältnis, zw?: Zero-Width }

const TIMEOUT_MS = 10000;
// BTTV markiert Overlay-Emotes nicht in der API – das sind die bekannten Zero-Width-Emotes.
const BTTV_ZERO_WIDTH = new Set(['SoSnowy', 'IceCold', 'SantaHat', 'TopHat', 'ReinDeer', 'CandyCane', 'cvMask', 'cvHazmat']);

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function fromSevenTv(list) {
  const out = [];
  for (const e of list || []) {
    const d = e.data || {};
    const host = d.host;
    if (!host || !host.url) continue;
    const base = host.url.startsWith('//') ? `https:${host.url}` : host.url;
    const f1 = (host.files || []).find((f) => f.name === '1x.webp');
    out.push({
      id: e.id,
      n: e.name,
      p: '7tv',
      u: [`${base}/1x.webp`, `${base}/2x.webp`, `${base}/4x.webp`],
      r: f1 && f1.height ? Number((f1.width / f1.height).toFixed(3)) : undefined,
      // Aktiv-Flag 1 bzw. Emote-Flag 256 = Zero-Width (legt sich über das vorige Emote)
      zw: Boolean((e.flags & 1) || (d.flags & 256)),
    });
  }
  return out;
}

function fromBttv(list) {
  return (list || [])
    .filter((e) => e && e.id && e.code && e.modifier !== true)
    .map((e) => ({
      n: e.code,
      p: 'bttv',
      u: ['1x', '2x', '3x'].map((s) => `https://cdn.betterttv.net/emote/${e.id}/${s}.webp`),
      r: e.width && e.height ? Number((e.width / e.height).toFixed(3)) : undefined,
      zw: BTTV_ZERO_WIDTH.has(e.code),
    }));
}

function fromFfzSet(set) {
  const out = [];
  for (const e of (set && set.emoticons) || []) {
    if (e.modifier && (e.modifier_flags & 1)) continue; // reine Effekt-Modifier ohne Bild
    const urls = e.animated || e.urls || {};
    const pick = (...keys) => keys.map((k) => urls[k]).find(Boolean);
    const small = pick('1', '2', '4');
    if (!small) continue;
    out.push({
      n: e.name,
      p: 'ffz',
      u: [small, pick('2', '1'), pick('4', '2', '1')],
      r: e.width && e.height ? Number((e.width / e.height).toFixed(3)) : undefined,
      zw: Boolean(e.modifier),
    });
  }
  return out;
}

async function loadEmotes(roomId, providers = {}) {
  const errors = [];
  const safe = async (label, enabled, fn) => {
    if (!enabled) return [];
    try {
      return await fn();
    } catch (e) {
      errors.push({ src: label, msg: e.message });
      return [];
    }
  };

  const [ffzGlobal, bttvGlobal, stvGlobal, ffzChannel, bttvChannel, stvChannel] = await Promise.all([
    safe('ffzGlobal', providers.ffz, async () => {
      const d = await getJson('https://api.frankerfacez.com/v1/set/global');
      return d ? (d.default_sets || []).flatMap((id) => fromFfzSet(d.sets[id])) : [];
    }),
    safe('bttvGlobal', providers.bttv, async () => fromBttv(await getJson('https://api.betterttv.net/3/cached/emotes/global'))),
    safe('stvGlobal', providers.seventv, async () => {
      const d = await getJson('https://7tv.io/v3/emote-sets/global');
      return fromSevenTv(d && d.emotes);
    }),
    safe('ffzChannel', providers.ffz, async () => {
      const d = await getJson(`https://api.frankerfacez.com/v1/room/id/${roomId}`);
      return d && d.room ? fromFfzSet(d.sets[d.room.set]) : [];
    }),
    safe('bttvChannel', providers.bttv, async () => {
      const d = await getJson(`https://api.betterttv.net/3/cached/users/twitch/${roomId}`);
      return d ? fromBttv([...(d.channelEmotes || []), ...(d.sharedEmotes || [])]) : [];
    }),
    // Liefert zusätzlich Set- und User-ID für die Live-Updates
    (async () => {
      const empty = { list: [], setId: '', userId: '' };
      if (!providers.seventv) return empty;
      try {
        const d = await getJson(`https://7tv.io/v3/users/twitch/${roomId}`);
        if (!d) return empty;
        return {
          list: fromSevenTv(d.emote_set && d.emote_set.emotes),
          setId: (d.emote_set && d.emote_set.id) || d.emote_set_id || '',
          userId: (d.user && d.user.id) || '',
        };
      } catch (e) {
        errors.push({ src: 'stvChannel', msg: e.message });
        return empty;
      }
    })(),
  ]);

  return {
    lists: { ffzGlobal, bttvGlobal, stvGlobal, ffzChannel, bttvChannel, stvChannel: stvChannel.list },
    errors,
    seventv: { setId: stvChannel.setId, userId: stvChannel.userId },
  };
}

// Reihenfolge = Rangfolge: Spätere gewinnen (Kanal vor global, 7TV vor BTTV vor FFZ)
const LIST_ORDER = ['ffzGlobal', 'bttvGlobal', 'stvGlobal', 'ffzChannel', 'bttvChannel', 'stvChannel'];

function buildMap(lists) {
  const map = new Map();
  for (const key of LIST_ORDER) for (const e of lists[key] || []) map.set(e.n, e);
  return map;
}

function countsOf(lists) {
  const n = (k) => (lists[k] || []).length;
  return {
    seventv: { channel: n('stvChannel'), global: n('stvGlobal') },
    bttv: { channel: n('bttvChannel'), global: n('bttvGlobal') },
    ffz: { channel: n('ffzChannel'), global: n('ffzGlobal') },
  };
}

// 7TV-Emotes für YouTube- oder Kick-Kanäle (7TV verknüpft Konten dieser Plattformen ebenfalls)
async function loadSevenTvPlatform(platform, id) {
  const errors = [];
  const safe = async (label, fn) => {
    try {
      return await fn();
    } catch (e) {
      errors.push({ src: label, msg: e.message });
      return [];
    }
  };
  const [stvGlobal, stvChannel] = await Promise.all([
    safe('stvGlobal', async () => {
      const d = await getJson('https://7tv.io/v3/emote-sets/global');
      return fromSevenTv(d && d.emotes);
    }),
    safe('stvChannel', async () => {
      if (!id) return [];
      const d = await getJson(`https://7tv.io/v3/users/${platform}/${encodeURIComponent(id)}`);
      return d ? fromSevenTv(d.emote_set && d.emote_set.emotes) : [];
    }),
  ]);
  return { lists: { stvGlobal, stvChannel }, errors };
}

// Einzelnes 7TV-Emote nachladen (falls ein Live-Update ohne Bilddaten kommt)
async function fetchSevenTvEmote(id) {
  try {
    return await getJson(`https://7tv.io/v3/emotes/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

module.exports = { loadEmotes, loadSevenTvPlatform, buildMap, countsOf, fromSevenTv, fetchSevenTvEmote };
