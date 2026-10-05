'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIrc, TwitchChat } = require('../server/twitch');
const { buildMap } = require('../server/emotes');

const emoteUrl = (id) => [1, 2, 3].map((s) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/${s}.0`);
const twitchEmote = (id, n) => ({ t: 'emote', n, p: 'twitch', u: emoteUrl(id) });

// Nur Konstruktor – kein start(), also keine Sockets und Timer
function makeChat(chat = {}) {
  const settings = { chat: { channel: 'streamer', hideBots: ['nightbot'], hideCommands: true, highlightWords: ['pizza'], emoteNotices: true, providers: {}, ...chat } };
  const tc = new TwitchChat(() => settings);
  tc.channel = settings.chat.channel; // setzt sonst _connect()
  const out = { messages: [], clears: [] };
  tc.on('message', (m) => out.messages.push(m));
  tc.on('clear', (c) => out.clears.push(c));
  return { tc, out };
}

test('parseIrc: tags, prefix, command and trailing param', () => {
  const m = parseIrc('@badges=broadcaster/1;color=#FF0000;display-name=Streamer;emotes= :streamer!streamer@streamer.tmi.twitch.tv PRIVMSG #streamer :hello :) world');
  assert.deepEqual(m.tags, { badges: 'broadcaster/1', color: '#FF0000', 'display-name': 'Streamer', emotes: '' });
  assert.equal(m.prefix, 'streamer!streamer@streamer.tmi.twitch.tv');
  assert.equal(m.command, 'PRIVMSG');
  assert.deepEqual(m.params, ['#streamer', 'hello :) world']);
});

test('parseIrc: IRCv3 tag value unescaping', () => {
  const m = parseIrc(String.raw`@a=one\stwo;b=x\:y;c=back\\slash;d=cr\rlf\n;e=unknown\q;f=trailing\;flag :tmi.twitch.tv USERNOTICE #c`);
  assert.equal(m.tags.a, 'one two');
  assert.equal(m.tags.b, 'x;y');
  assert.equal(m.tags.c, 'back\\slash');
  assert.equal(m.tags.d, 'cr\rlf\n');
  assert.equal(m.tags.e, 'unknownq'); // unbekanntes Escape: Backslash fällt weg
  assert.equal(m.tags.f, 'trailing'); // einzelner Backslash am Ende fällt weg
  assert.equal(m.tags.flag, ''); // Tag ohne Wert
});

test('parseIrc: messages without tags, prefix or trailing', () => {
  assert.deepEqual(parseIrc('PING :tmi.twitch.tv'), { tags: {}, prefix: '', command: 'PING', params: ['tmi.twitch.tv'] });
  assert.deepEqual(parseIrc('RECONNECT'), { tags: {}, prefix: '', command: 'RECONNECT', params: [] });
  assert.deepEqual(parseIrc(':tmi.twitch.tv 001 justinfan123 :Welcome, GLHF!').params, ['justinfan123', 'Welcome, GLHF!']);
  assert.deepEqual(parseIrc(':nick!nick@nick.tmi.twitch.tv JOIN #chan').params, ['#chan']);
  assert.deepEqual(parseIrc(':u!u@u PRIVMSG #c ::)').params, ['#c', ':)']); // Text beginnt mit Doppelpunkt
  assert.deepEqual(parseIrc(':u!u@u PRIVMSG #c :').params, ['#c', '']);
});

test('tokenize: Twitch emote ranges count code points, not UTF-16 units', () => {
  const { tc } = makeChat();
  assert.deepEqual(tc.tokenize('Kappa hello', '25:0-4'), [twitchEmote('25', 'Kappa'), { t: 'text', v: ' hello' }]);
  assert.deepEqual(tc.tokenize('👋 Kappa', '25:2-6'), [{ t: 'text', v: '👋 ' }, twitchEmote('25', 'Kappa')]);
  assert.deepEqual(tc.tokenize('Kappa Keepo Kappa', '25:0-4,12-16/1902:6-10'), [
    twitchEmote('25', 'Kappa'),
    { t: 'text', v: ' ' },
    twitchEmote('1902', 'Keepo'),
    { t: 'text', v: ' ' },
    twitchEmote('25', 'Kappa'),
  ]);
});

test('tokenize: malformed or overlapping emote tags are ignored', () => {
  const { tc } = makeChat();
  const plain = [{ t: 'text', v: 'Kappa hi' }];
  assert.deepEqual(tc.tokenize('Kappa hi', ''), plain);
  assert.deepEqual(tc.tokenize('Kappa hi', undefined), plain);
  assert.deepEqual(tc.tokenize('Kappa hi', '25'), plain);
  assert.deepEqual(tc.tokenize('Kappa hi', '25:a-b'), plain);
  assert.deepEqual(tc.tokenize('Kappa hi', ':0-4'), plain);
  assert.deepEqual(tc.tokenize('Kappa hi', '25:0-4/26:2-6'), [twitchEmote('25', 'Kappa'), { t: 'text', v: ' hi' }]);
});

test('tokenize: third-party emotes and mentions in free text', () => {
  const { tc } = makeChat();
  const cat = { n: 'catJAM', p: '7tv', u: ['a', 'b', 'c'], r: 1 };
  tc.emotes = buildMap({ stvChannel: [cat] });
  assert.deepEqual(tc.tokenize('@Streamer catJAM  @other!', ''), [
    { t: 'mention', v: '@Streamer', me: true },
    { t: 'text', v: ' ' },
    { t: 'emote', n: 'catJAM', p: '7tv', u: ['a', 'b', 'c'], r: 1 },
    { t: 'text', v: ' ' },
    { t: 'mention', v: '@other!', me: false },
  ]);
});

test('PRIVMSG becomes a chat message with user, badges and tokens', () => {
  const { tc, out } = makeChat();
  tc._onLine('@badge-info=subscriber/14;badges=broadcaster/1,subscriber/12,glhf-pledge/1;color=#1E90FF;display-name=Streamer;emotes=25:0-4;first-msg=0;id=abc-123;returning-chatter=0;room-id=1;tmi-sent-ts=1700000000000;user-id=1 :streamer!streamer@streamer.tmi.twitch.tv PRIVMSG #streamer :Kappa hello world');
  assert.equal(out.messages.length, 1);
  assert.deepEqual(out.messages[0], {
    id: 'abc-123',
    platform: 'twitch',
    kind: 'msg',
    ts: 1700000000000,
    user: { id: '1', login: 'streamer', name: 'Streamer', color: '#1E90FF', badges: ['broadcaster', 'subscriber'] },
    action: false,
    first: false,
    returning: false,
    reward: false,
    shared: false,
    highlight: false,
    tokens: [twitchEmote('25', 'Kappa'), { t: 'text', v: ' hello world' }],
  });
});

test('PRIVMSG: /me actions, flags and fallbacks without tags', () => {
  const { tc, out } = makeChat();
  const before = Date.now();
  tc._onLine(':viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #streamer :\u0001ACTION waves\u0001');
  const m = out.messages[0];
  assert.equal(m.action, true);
  assert.deepEqual(m.tokens, [{ t: 'text', v: 'waves' }]);
  assert.equal(m.user.name, 'viewer');
  assert.match(m.id, /^[0-9a-f-]{36}$/);
  assert.ok(m.ts >= before);

  tc._onLine('@first-msg=1;custom-reward-id=r1;room-id=1;source-room-id=2 :new!new@new PRIVMSG #streamer :hi');
  const f = out.messages[1];
  assert.equal(f.first, true);
  assert.equal(f.reward, true);
  assert.equal(f.shared, true);
});

test('PRIVMSG: bots and !commands are hidden, bits become events', () => {
  const { tc, out } = makeChat();
  tc._onLine(':NightBot!nightbot@nightbot PRIVMSG #streamer :Follow the stream!');
  tc._onLine(':viewer!viewer@viewer PRIVMSG #streamer :!uptime');
  assert.equal(out.messages.length, 0);
  tc._onLine('@bits=100;display-name=Cheerer :cheerer!cheerer@cheerer PRIVMSG #streamer :Cheer100 nice');
  assert.equal(out.messages[0].kind, 'event');
  assert.deepEqual(out.messages[0].event, { type: 'bits', icon: '💎', key: 'ev.bits', vars: { name: 'Cheerer', n: 100 } });

  const { tc: tc2, out: out2 } = makeChat({ hideCommands: false, hideBots: [] });
  tc2._onLine(':nightbot!nightbot@nightbot PRIVMSG #streamer :!uptime');
  assert.equal(out2.messages.length, 1);
});

test('PRIVMSG: highlights for own channel mention, keywords and highlighted messages', () => {
  const { tc, out } = makeChat();
  const say = (text, tags = '') => {
    tc._onLine(`${tags ? `@${tags} ` : ''}:v!v@v PRIVMSG #streamer :${text}`);
    return out.messages[out.messages.length - 1].highlight;
  };
  assert.equal(say('hey @STREAMER how are you'), true);
  assert.equal(say('I want PIZZA'), true);
  assert.equal(say('nothing special', 'msg-id=highlighted-message'), true);
  assert.equal(say('just chatting'), false);
});

test('PRIVMSG: mentioning a longer name that starts with the channel is no highlight', () => {
  const { tc, out } = makeChat();
  tc._onLine(':v!v@v PRIVMSG #streamer :hey @streamerfan');
  tc._onLine(':v!v@v PRIVMSG #streamer :@streamerfan and @Streamer, hi');
  tc._onLine(':v!v@v PRIVMSG #streamer :gg @streamer');
  assert.deepEqual(out.messages.map((m) => m.highlight), [false, true, true]);
});

test('USERNOTICE: subs, resubs, raids and system messages', () => {
  const { tc, out } = makeChat();
  tc._onLine(String.raw`@badges=staff/1;display-name=ronni;emotes=;id=db25;login=ronni;msg-id=resub;msg-param-cumulative-months=6;msg-param-sub-plan=Prime;system-msg=ronni\shas\ssubscribed\sfor\s6\smonths!;tmi-sent-ts=1507246572675;user-id=87654321 :tmi.twitch.tv USERNOTICE #streamer :Great stream -- keep it up!`);
  tc._onLine('@display-name=Sub;login=sub;msg-id=sub;msg-param-sub-plan=1000 :tmi.twitch.tv USERNOTICE #streamer');
  tc._onLine('@display-name=raider;login=raider;msg-id=raid;msg-param-displayName=Raider;msg-param-viewerCount=42 :tmi.twitch.tv USERNOTICE #streamer');
  tc._onLine(String.raw`@login=x;msg-id=somethingnew;system-msg=Something\snew\shappened :tmi.twitch.tv USERNOTICE #streamer`);
  tc._onLine('@login=x;msg-id=somethingnew :tmi.twitch.tv USERNOTICE #streamer'); // ohne system-msg: ignorieren

  assert.equal(out.messages.length, 4);
  const [resub, sub, raid, sys] = out.messages;
  assert.deepEqual(resub.event, { type: 'sub', icon: '★', key: 'ev.resub', vars: { name: 'ronni', n: 6, plan: ' (Prime)' } });
  assert.equal(resub.kind, 'event');
  assert.equal(resub.ts, 1507246572675);
  assert.deepEqual(resub.tokens, [{ t: 'text', v: 'Great stream -- keep it up!' }]);
  assert.deepEqual(sub.event.vars, { name: 'Sub', plan: ' (Tier 1)' });
  assert.deepEqual(sub.tokens, []);
  assert.deepEqual(raid.event, { type: 'raid', icon: '⚔', key: 'ev.raid', vars: { name: 'Raider', n: 42 } });
  assert.deepEqual(sys.event, { type: 'info', icon: '✦', key: 'ev.system', vars: { text: 'Something new happened' } });
});

test('USERNOTICE: single gifts of a gift bomb are folded into one event', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { tc, out } = makeChat();
  const gift = (to) => tc._onLine(`@display-name=Gifter;login=gifter;msg-id=subgift;msg-param-community-gift-id=G1;msg-param-recipient-display-name=${to} :tmi.twitch.tv USERNOTICE #streamer`);
  tc._onLine('@display-name=Gifter;login=gifter;msg-id=submysterygift;msg-param-community-gift-id=G1;msg-param-mass-gift-count=3 :tmi.twitch.tv USERNOTICE #streamer');
  gift('a');
  gift('b');
  gift('c');
  assert.equal(out.messages.length, 1);
  assert.deepEqual(out.messages[0].event, { type: 'gift', icon: '🎁', key: 'ev.giftbomb', vars: { name: 'Gifter', n: 3 } });
  gift('d'); // mehr als angekündigt → wieder einzeln
  assert.equal(out.messages.length, 2);
  assert.deepEqual(out.messages[1].event.vars, { name: 'Gifter', to: 'd' });

  // Unvollständige Gift-Bombe: nach 60 s wird die Zusammenfassung verworfen
  tc._onLine('@display-name=Gifter;login=gifter;msg-id=submysterygift;msg-param-community-gift-id=G1;msg-param-mass-gift-count=5 :tmi.twitch.tv USERNOTICE #streamer');
  gift('e');
  assert.equal(out.messages.length, 3);
  t.mock.timers.tick(60000);
  gift('f');
  assert.equal(out.messages.length, 4);
});

test('CLEARCHAT, CLEARMSG, PING and NOTICE', () => {
  const { tc, out } = makeChat();
  tc._onLine('@room-id=1;target-user-id=99 :tmi.twitch.tv CLEARCHAT #streamer :baduser');
  tc._onLine('@room-id=1 :tmi.twitch.tv CLEARCHAT #streamer');
  tc._onLine('@login=x;target-msg-id=m1 :tmi.twitch.tv CLEARMSG #streamer :bad');
  tc._onLine('@login=x :tmi.twitch.tv CLEARMSG #streamer :bad');
  assert.deepEqual(out.clears, [{ userId: '99' }, { all: true, platform: 'twitch' }, { msgId: 'm1' }]);

  const sent = [];
  tc.ws = { send: (s) => sent.push(s) };
  tc._onLine('PING :tmi.twitch.tv');
  tc._onLine('PING');
  assert.deepEqual(sent, ['PONG :tmi.twitch.tv', 'PONG :tmi.twitch.tv']);
  tc.ws = null;

  tc._onLine('@msg-id=msg_channel_suspended :tmi.twitch.tv NOTICE #streamer :This channel has been suspended.');
  assert.equal(tc.status.error, 'Twitch: This channel has been suspended.');
  tc._onLine(':tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!');
  assert.equal(out.messages.length, 0);
});
