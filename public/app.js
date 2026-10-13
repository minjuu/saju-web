const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 콘텐츠 ----------
const YEAR = new Date().getFullYear();
const NEW_YEAR = new Date().getMonth() >= 9 ? YEAR + 1 : YEAR; // 10월부터는 다음 해 신년 운세
const TOPICS = {
  total: { mark: '命', title: '평생 사주', desc: '타고난 성격부터 일, 돈, 사랑, 앞으로의 흐름까지 한 번에 알아봐요!', color: 'c1', badge: '가장 많이 봐요' },
  year: { mark: '年', title: `${NEW_YEAR} 신년 운세`, desc: `${NEW_YEAR}년에 어떤 일이 기다리고 있을지 계절별로 미리 알아봐요!`, color: 'c2', badge: 'NEW' },
  love: { mark: '緣', title: '연애운', desc: '나의 연애 스타일과 잘 맞는 사람, 올해 찾아올 인연을 알아봐요!', color: 'c3' },
};
const SLIDES = [
  { title: '어떤 운세가 궁금하세요?', sub: '타고난 성격부터 올해의 흐름까지 알려드려요', topic: 'total', bg: 'b1' },
  { title: `${NEW_YEAR}년, 나의 운세는?`, sub: '계절마다 어떤 흐름이 오는지 미리 확인해 보세요', topic: 'year', bg: 'b2' },
  { title: '하루 한 번 무료 풀이', sub: '로그인하면 하루 한 번 무료로 볼 수 있어요', topic: 'total', bg: 'b3' },
];

$('#cards').innerHTML = Object.entries(TOPICS).map(([key, t], i) => `
  <a class="topic-card ${t.color}${i === 0 ? ' featured' : ''}" href="#/saju/${key}" data-mark="${t.mark}">
    <div class="topic-top"><span class="topic-glyph">${t.mark}</span>${t.badge ? `<em>${t.badge}</em>` : ''}</div>
    <b>${t.title}</b>
    <p>${t.desc}</p>
    <span class="go">보기 →</span>
  </a>`).join('');

$('#slides').innerHTML = SLIDES.map(s => `
  <a class="slide" href="#/saju/${s.topic}"><h2>${s.title}</h2><p>${s.sub}</p><span class="cta">풀이 보기</span></a>`).join('');
let slide = 0;
let dailyLimit = false;
function showSlide(i) {
  const n = dailyLimit ? SLIDES.length : SLIDES.length - 1;
  slide = (i + n) % n;
  $('#slides').style.transform = `translateX(-${slide * 100}%)`;
  $('#counter').textContent = `${String(slide + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
}
$('#prev').onclick = () => showSlide(slide - 1);
$('#next').onclick = () => showSlide(slide + 1);
setInterval(() => { if (!document.hidden) showSlide(slide + 1); }, 5000);
showSlide(0);

// ---------- 라우팅 ----------
let topic = 'total';
function route() {
  const [, page, arg] = location.hash.split('/');
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  if (page === 'saju' && TOPICS[arg]) {
    topic = arg;
    const t = TOPICS[arg];
    $('#topicMark').textContent = t.mark;
    $('#topicMark').className = `topic-mark ${t.color}`;
    $('#topicTitle').textContent = t.title;
    $('#topicDesc').textContent = t.desc;
    ['#chart', '#loginCta', '#readingCard'].forEach(s => $(s).classList.add('hidden'));
    $('#error').textContent = '';
    $('#view-reading').classList.remove('hidden');
    refreshQuota();
  } else if (page === 'tarot' && window.openTarot?.(arg)) {
    $('#view-tarot').classList.remove('hidden');
  } else if (page === 'login') {
    if (user) { location.hash = '#/'; return; }
    $('#view-login').classList.remove('hidden');
  } else {
    $('#view-home').classList.remove('hidden');
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---------- 로그인 (Supabase) ----------
let sb = null;
let user = null;
const PROVIDERS = {
  kakao: { label: '카카오로 시작하기', icon: '<svg viewBox="0 0 24 24"><path fill="#191919" d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.6c-.1.3.3.6.6.4l4.3-2.8c.5.1.9.1 1.4.1 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>' },
  google: { label: 'Google로 시작하기', icon: '<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9l3.7-2.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>' },
  apple: { label: 'Apple로 시작하기', icon: '<svg viewBox="0 0 24 24"><path fill="#000" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.6-1-2.6-4.1zM13.9 5c.7-.9 1.2-2 1-3.2-1 0-2.2.7-3 1.5-.6.7-1.2 1.9-1 3.1 1.1.1 2.3-.6 3-1.4z"/></svg>' },
};

async function initAuth() {
  const cfg = await fetch('/api/config').then(r => r.json());
  dailyLimit = cfg.dailyLimit;
  applyLimitCopy();
  const oauth = cfg.providers.filter(p => PROVIDERS[p]);
  $('#oauthButtons').innerHTML = oauth.map(p =>
    `<button class="sns ${p}" type="button" data-provider="${p}">${PROVIDERS[p].icon}${PROVIDERS[p].label}</button>`).join('');
  const hasEmail = cfg.providers.includes('email');
  $('#emailDivider').classList.toggle('hidden', !hasEmail || !oauth.length);
  $('#emailToggle').classList.toggle('hidden', !hasEmail);
  $('#loginFoot').classList.toggle('hidden', !oauth.length);

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    $('#authNav').innerHTML = ''; // 로그인 미설정이면 메뉴에서 숨김
    $('#loginError').textContent = '로그인은 아직 준비 중이에요.';
    return;
  }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { flowType: 'pkce' } });
  sb.auth.onAuthStateChange((_event, session) => {
    user = session?.user || null;
    renderAuthNav();
    if (user && location.hash.startsWith('#/login')) location.hash = sessionStorage.getItem('afterLogin') || '#/';
    refreshQuota();
  });
}

function renderAuthNav() {
  if (!user) { $('#authNav').innerHTML = '<a class="pill" href="#/login">로그인</a>'; return; }
  const name = user.user_metadata?.name || user.user_metadata?.full_name || user.email || '회원';
  $('#authNav').innerHTML = `<span class="who">${esc(name)}</span> <button class="link" id="logout">로그아웃</button>`;
  $('#logout').onclick = async () => { await sb.auth.signOut(); location.hash = '#/'; };
}

$('#oauthButtons').onclick = async e => {
  const btn = e.target.closest('[data-provider]');
  if (!btn || !sb) return;
  $('#loginError').textContent = '';
  const { error } = await sb.auth.signInWithOAuth({ provider: btn.dataset.provider, options: { redirectTo: location.origin + '/' } });
  if (error) $('#loginError').textContent = error.message;
};

let signUpMode = false;
$('#emailToggle').onclick = () => { $('#emailForm').classList.toggle('hidden'); $('#email').focus(); };
$('#modeToggle').onclick = () => {
  signUpMode = !signUpMode;
  $('#emailSubmit').textContent = signUpMode ? '회원가입' : '로그인';
  $('#modeToggle').textContent = signUpMode ? '이미 계정이 있나요? 로그인' : '계정이 없나요? 회원가입';
  $('#password').autocomplete = signUpMode ? 'new-password' : 'current-password';
};
$('#emailForm').onsubmit = async e => {
  e.preventDefault();
  if (!sb) return;
  $('#loginError').textContent = ''; $('#loginInfo').textContent = '';
  const email = $('#email').value.trim(), password = $('#password').value;
  const { data, error } = signUpMode
    ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + '/' } })
    : await sb.auth.signInWithPassword({ email, password });
  if (error) { $('#loginError').textContent = authError(error); return; }
  if (signUpMode && !data.session) $('#loginInfo').textContent = '확인 메일을 보냈어요. 메일 속 링크를 누르면 가입이 끝나요!';
};
function authError(e) {
  if (/Invalid login credentials/i.test(e.message)) return '이메일이나 비밀번호가 맞지 않아요.';
  if (/already registered/i.test(e.message)) return '이미 가입된 이메일이에요.';
  if (/Email not confirmed/i.test(e.message)) return '아직 이메일 인증 전이에요. 받은 메일을 확인해 주세요.';
  return e.message;
}
document.addEventListener('click', e => {
  if (e.target.closest('a[href="#/login"]')) sessionStorage.setItem('afterLogin', location.hash.startsWith('#/saju') ? location.hash : '#/');
});

async function token() {
  const { data } = sb ? await sb.auth.getSession() : { data: {} };
  return data.session?.access_token;
}

let usedToday = false;
// 제한이 꺼져 있으면 '하루 한 번' 안내 문구를 숨긴다
function applyLimitCopy() {
  document.querySelector('.notice').classList.toggle('hidden', !dailyLimit);
  $('#slides').children[2]?.classList.toggle('hidden', !dailyLimit);
  showSlide(slide);
  $('#quotaHint').textContent = '';
}
async function refreshQuota() {
  if (!dailyLimit) return;
  if (!user) { usedToday = false; $('#quotaHint').textContent = '사주팔자 표는 로그인 없이도 볼 수 있어요.'; return; }
  try {
    const r = await fetch('/api/quota', { headers: { Authorization: `Bearer ${await token()}` } }).then(r => r.json());
    usedToday = !!r.usedToday;
    $('#quotaHint').textContent = usedToday ? '오늘 풀이를 이미 봤습니다. 사주팔자 표는 계속 볼 수 있습니다.' : '오늘 풀이 1회 남음';
  } catch { $('#quotaHint').textContent = ''; }
}

// ---------- 로딩 표시 ----------
// 응답 첫 글자가 오기 전까지 진행 막대와 안내 문구를 보여준다. 막대는 시간이 지날수록 천천히 90% 근처까지 찬다
const LOADING_MSGS = {
  saju: ['풀이를 쓰고 있어요. 꼼꼼히 쓰느라 1~3분 정도 걸려요.', '여덟 글자와 운의 흐름을 하나씩 살펴보고 있어요.', '거의 다 됐어요. 내용을 정리하고 있어요.', '평소보다 조금 오래 걸리고 있어요. 창을 닫지 말고 잠시만 기다려 주세요.'],
  tarot: ['카드를 읽고 있어요. 보통 20초에서 40초 정도 걸려요.', '카드의 위치와 방향을 함께 살펴보고 있어요.', '거의 다 됐어요. 내용을 정리하고 있어요.', '평소보다 조금 오래 걸리고 있어요. 창을 닫지 말고 잠시만 기다려 주세요.'],
};
window.startLoading = (out, kind) => {
  const msgs = LOADING_MSGS[kind];
  out.innerHTML = `<div class="loader"><div class="loader-bar"><span></span></div><p class="loader-msg">${msgs[0]}</p></div>`;
  const bar = out.querySelector('.loader-bar span'), msg = out.querySelector('.loader-msg');
  const t0 = Date.now();
  const tick = setInterval(() => {
    const s = (Date.now() - t0) / 1000;
    if (!bar.isConnected) return clearInterval(tick);
    bar.style.width = `${Math.min(92, 92 * (1 - Math.exp(-s / 25)))}%`;
    msg.textContent = msgs[s < 15 ? 0 : s < 35 ? 1 : s < 70 ? 2 : 3];
  }, 1000);
  requestAnimationFrame(() => { bar.style.width = '8%'; });
  return () => clearInterval(tick);
};

// 따옴표("…", “…”) 안의 글자를 굵게 (태그 안 속성은 건드리지 않도록 텍스트 노드만 바꾼다)
window.boldQuotes = root => {
  // **"…"**처럼 이미 굵은 글자를 감싼 따옴표도 지운다
  root.querySelectorAll('strong').forEach(st => { st.textContent = st.textContent.replace(/^["“'‘]\s*(.+?)\s*["”'’]$/, '$1'); });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (/["“][^"”]+["”]/.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (!n.parentElement || n.parentElement.closest('strong, h2, h3, code')) continue;
    const span = document.createElement('span');
    span.innerHTML = esc(n.nodeValue).replace(/(&quot;|“)([^"”<]{1,80}?)(&quot;|”)/g, '<strong>$2</strong>');
    n.replaceWith(...span.childNodes);
  }
};

// 한글·따옴표 바로 옆의 **굵게**는 마크다운 규칙상 인식이 안 되는 경우가 많아, 파싱 전에 직접 <strong>으로 바꾼다
// 따옴표(" “ ” ‘ ’ ')로 감싼 말은 따옴표를 지우고 굵게 만든다. 점수 코드 블록(```)은 건드리지 않는다
window.mdPrep = text => text.split(/(```[\s\S]*?(?:```|$))/).map((part, i) => i % 2 ? part : part
  .replace(/\*\*\s*["“‘']\s*([^"“”‘’'\n*]{1,80}?)\s*["”’']\s*\*\*/g, '**$1**') // **"말"**
  .replace(/["“‘']\s*\*\*([^*\n]{1,80}?)\*\*\s*["”’']/g, '**$1**')             // "**말**"
  .replace(/[“‘]([^“”‘’\n]{1,80}?)[”’]/g, '**$1**')                           // “말”, ‘말’
  .replace(/"([^"\n]{1,80}?)"/g, '**$1**')                                     // "말"
  .replace(/'([가-힣][^'\n]{0,79}?)'/g, '**$1**')                               // '말'
  .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
  .replace(/~/g, '&#126;')).join(''); // "1~3월 … 4~6월"이 취소선(~~)으로 바뀌지 않게

// ---------- 풀이 리포트 ----------
// 서버(모델)는 "## 섹션 / ### 소제목 / ```scores``` 블록" 형식의 마크다운을 스트리밍한다.
// 이를 섹션 탭 + 섹션 카드 + 라벨 + 능력치 차트로 바꿔 그린다. 글자가 올 때마다 다시 그린다
function parseScores(src) {
  return src.split('\n').map(l => l.split('|').map(x => x.trim()))
    .filter(p => p.length >= 3 && p[0] && /^\d+$/.test(p[1]))
    .map(([name, v, desc]) => ({ name, v: Math.max(0, Math.min(100, Number(v))), desc: (desc || '').replace(/["“”‘’]/g, '') }));
}
function radar(items) {
  if (items.length < 5) return ''; // 항목이 적으면(계절·연도별) 막대만 보여준다
  const R = 90, cx = 130, cy = 120, n = items.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const ring = f => items.map((_, i) => pt(i, R * f).join(',')).join(' ');
  const shape = items.map((it, i) => pt(i, (R * it.v) / 100).join(',')).join(' ');
  const labels = items.map((it, i) => {
    const [x, y] = pt(i, R + 18);
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${esc(it.name)}</text>`;
  }).join('');
  const axes = items.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`; }).join('');
  return `<svg class="radar" viewBox="0 0 260 245" role="img" aria-label="능力치 차트">
    <g class="grid">${[1, 0.66, 0.33].map(f => `<polygon points="${ring(f)}"/>`).join('')}${axes}</g>
    <polygon class="shape" points="${shape}"/>
    ${items.map((it, i) => { const [x, y] = pt(i, (R * it.v) / 100); return `<circle cx="${x}" cy="${y}" r="3.5"/>`; }).join('')}
    <g class="labels">${labels}</g></svg>`;
}
function scoresHtml(items) {
  return radar(items) + items.map(it => `<div class="score">
    <div class="score-top"><b>${esc(it.name)}</b><span class="score-bar"><i style="width:${it.v}%"></i></span><em>${it.v}</em></div>
    ${it.desc ? `<p>${esc(it.desc)}</p>` : ''}</div>`).join('');
}
// 섹션·라벨 제목 앞에 붙일 이모지 (제목에 들어 있는 단어로 고른다)
const EMOJI = [
  ['한 줄 요약', '📝'], ['성격', '🧠'], ['배우자', '💍'], ['사람 관계', '🤝'], ['답변', '💬'], ['안 맞는', '🚫'], ['가까워지는', '💓'],
  ['무의식', '🌑'], ['반복되는 흐름', '🔁'], ['총평', '📝'], ['이렇게', '🧭'], ['돈이 들어오는', '💰'],
  ['한마디', '💌'], ['질문', '💬'], ['능력치', '📊'], ['점수', '📊'], ['연애 성향', '💞'], ['인연', '🔮'],
  ['연애 흐름', '🌊'], ['패턴', '🌗'], ['잘 맞는 사람', '🧪'], ['타고난', '🔥'], ['일과 돈', '💼'],
  ['사랑과 관계', '💞'], ['앞으로', '🧭'], ['한눈에', '✨'], ['계절별', '🗓️'], ['분야별', '🧩'], ['주의할 시기', '⚠️'],
  ['봄', '🌸'], ['여름', '☀️'], ['가을', '🍂'], ['겨울', '❄️'], ['핵심', '💎'], ['솔로', '💫'], ['연애 중', '💑'],
  ['매력', '✨'], ['조심', '⚠️'], ['약점', '⚠️'], ['강점', '💪'], ['스타일', '💗'], ['바꾸는 방법', '🛠️'],
  ['돈', '💰'], ['일', '💼'], ['건강', '🌿'], ['키워드', '🔑'], ['연애', '💗'], ['년', '📅'],
];
const emojiFor = t => EMOJI.find(([k]) => t.includes(k))?.[1] || '';
let reportTab = 0;
function renderReport(out, text) {
  const tmp = document.createElement('div');
  tmp.innerHTML = DOMPurify.sanitize(marked.parse(mdPrep(text)));
  // 모델이 ####로 쓴 소제목도 라벨로 보이게
  tmp.querySelectorAll('h4, h5').forEach(h => { const h3 = document.createElement('h3'); h3.innerHTML = h.innerHTML; h.replaceWith(h3); });
  // 모델이 구성 안내("— 설명")까지 제목에 붙이는 경우가 있어 잘라낸다
  tmp.querySelectorAll('h2, h3').forEach(h => {
    h.textContent = h.textContent
      .replace(/\s*\([^)]*#.*$/, '')     // "(### 답변 …" 같은 구성 안내
      .replace(/\s*#+\s.*$/, '')          // 제목 안에 남은 "### …"
      .split(/\s+[—–-]\s+/)[0].replace(/\*\*/g, '').trim();
  });
  tmp.querySelectorAll('pre > code.language-scores').forEach(code => {
    const items = parseScores(code.textContent);
    // 스트리밍 중이거나 항목이 너무 적은 점수 블록은 그래프 대신 숨긴다
    if (items.length < 3) return code.parentElement.remove();
    const box = document.createElement('div');
    box.className = 'scores';
    box.innerHTML = scoresHtml(items);
    code.parentElement.replaceWith(box);
  });
  tmp.querySelectorAll('hr').forEach(h => h.remove());
  // 번호 목록(1. 2.)은 번호 없이 문단으로 바꾼다
  tmp.querySelectorAll('ol, ul').forEach(list => {
    const ps = [...list.children].map(li => { const p = document.createElement('p'); p.innerHTML = li.innerHTML; return p; });
    list.replaceWith(...ps);
  });
  // 문단 앞이나 문장 중간의 "1) ", "2. ", "①" 같은 번호를 지운다 (연도·소수점은 그대로)
  tmp.querySelectorAll('p').forEach(p => {
    p.innerHTML = p.innerHTML
      .replace(/^\s*(\d+[.)]|[①-⑨])\s+/, '')
      .replace(/(^|[\s>(])\d\)\s*/g, '$1')
      .replace(/[①-⑨]\s*/g, '');
  });
  boldQuotes(tmp);
  const sections = [];
  let cur = null;
  for (const node of [...tmp.childNodes]) {
    if (node.nodeName === 'H2') { cur = { title: node.textContent.trim(), nodes: [] }; sections.push(cur); continue; }
    if (!cur) { cur = { title: '', nodes: [] }; sections.push(cur); }
    cur.nodes.push(node);
  }
  // 같은 제목의 섹션이 두 번 나오면(섹션별로 따로 쓰다 보니 생김) 내용이 긴 쪽만 남긴다
  const textLen = s => s.nodes.reduce((n, x) => n + (x.textContent || '').trim().length, 0);
  for (let i = sections.length - 1; i >= 0; i--) {
    const j = sections.findIndex((t, k) => k !== i && t.title && t.title === sections[i].title);
    if (j >= 0) sections.splice(textLen(sections[i]) >= textLen(sections[j]) ? j : i, 1);
  }
    // 편지(한마디)는 항상 맨 끝에 둔다
  const li = sections.findIndex(s => s.title.includes('한마디'));
  if (li >= 0 && li < sections.length - 1) sections.push(sections.splice(li, 1)[0]);
  const titled = sections.filter(s => s.title);
  out.innerHTML = (titled.length > 1 ? `<nav class="rp-tabs">${titled.map((s, i) =>
    `<button type="button" data-i="${i}" class="${i === reportTab ? 'on' : ''}">${emojiFor(s.title)} ${esc(s.title)}</button>`).join('')}</nav>` : '') +
    sections.map(s => {
      const i = titled.indexOf(s);
      const letter = s.title.includes('한마디') ? ' rp-letter' : '';
      return `<section class="rp-sec card${letter}" ${i >= 0 ? `id="rp-${i}"` : ''}>${s.title ? `<h2>${emojiFor(s.title)} ${esc(s.title)}</h2>` : ''}<div class="rp-body"></div></section>`;
    }).join('');
  out.querySelectorAll('.rp-body').forEach((body, i) => sections[i].nodes.forEach(n => body.appendChild(n)));
}
document.addEventListener('click', e => {
  const b = e.target.closest('.rp-tabs button');
  if (!b) return;
  reportTab = Number(b.dataset.i);
  document.getElementById(`rp-${reportTab}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
// 스크롤 위치에 맞춰 탭 강조
window.addEventListener('scroll', () => {
  const secs = [...document.querySelectorAll('#reading .rp-sec[id]')];
  if (!secs.length) return;
  let active = 0;
  secs.forEach((s, i) => { if (s.getBoundingClientRect().top < 160) active = i; });
  if (active === reportTab) return;
  reportTab = active;
  document.querySelectorAll('#reading .rp-tabs button').forEach((b, i) => {
    b.classList.toggle('on', i === active);
    if (i === active) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  });
}, { passive: true });

// ---------- 사주 입력 · 결과 ----------
document.querySelectorAll('input[name=calendar]').forEach(el => el.onchange = () =>
  $('#leapWrap').classList.toggle('hidden', $('input[name=calendar]:checked').value !== 'lunar'));
document.querySelector('input[name=timeUnknown]').onchange = e => $('#time').disabled = e.target.checked;

// 로그인하러 다녀와도 입력값이 남도록 저장
const FORM_KEY = 'sajuForm';
function saveForm(body) { try { localStorage.setItem(FORM_KEY, JSON.stringify(body)); } catch {} }
function restoreForm() {
  let b; try { b = JSON.parse(localStorage.getItem(FORM_KEY)); } catch {}
  if (!b) return;
  document.querySelector(`input[name=calendar][value=${b.calendar}]`).checked = true;
  document.querySelector(`input[name=gender][value=${b.gender}]`).checked = true;
  document.querySelector('input[name=leapMonth]').checked = !!b.leapMonth;
  document.querySelector('input[name=timeUnknown]').checked = !!b.timeUnknown;
  $('#leapWrap').classList.toggle('hidden', b.calendar !== 'lunar');
  $('#time').disabled = !!b.timeUnknown;
  const p = n => String(n).padStart(2, '0');
  $('#date').value = `${b.year}-${p(b.month)}-${p(b.day)}`;
  $('#time').value = `${p(b.hour)}:${p(b.minute)}`;
  $('#question').value = b.question || '';
  $('#name').value = b.name || '';
}

function payload() {
  const [year, month, day] = $('#date').value.split('-').map(Number);
  const [hour, minute] = ($('#time').value || '12:00').split(':').map(Number);
  return {
    topic,
    calendar: $('input[name=calendar]:checked').value,
    leapMonth: document.querySelector('input[name=leapMonth]').checked,
    gender: $('input[name=gender]:checked').value,
    year, month, day, hour, minute,
    timeUnknown: document.querySelector('input[name=timeUnknown]').checked,
    question: $('#question').value.trim(),
    name: $('#name').value.trim(),
  };
}

function renderChart(s) {
  const cell = (p, part) => p
    ? `<div class="char e-${p[part].element}">${p[part].hanja}<span>${p[part].korean} · ${p[part].element}</span></div><div class="god">${p[part].tenGod}</div>`
    : `<div class="char empty">?<span>모름</span></div><div class="god">&nbsp;</div>`;
  const cols = [['time', '시주'], ['day', '일주'], ['month', '월주'], ['year', '연주']];
  const max = Math.max(...Object.values(s.elements), 1);
  const color = { 목: 'var(--wood)', 화: 'var(--fire)', 토: 'var(--earth)', 금: 'var(--metal)', 수: 'var(--water)' };
  $('#chartBody').innerHTML = `
    <div class="meta">양력 ${s.solarDate} · 음력 ${s.lunarDate} · 일간 <b>${s.dayMaster}</b></div>
    <div class="pillars">${cols.map(([k, name]) => `<div class="pillar"><div class="head">${name}</div>
      ${cell(s.pillars[k], 'stem')}${cell(s.pillars[k], 'branch')}</div>`).join('')}</div>
    <div class="bars">${Object.entries(s.elements).map(([e, n]) =>
      `<div class="bar"><div style="background:${color[e]};opacity:${0.25 + 0.75 * n / max}"></div>${e} ${n}</div>`).join('')}</div>
    <div class="daeun">${s.daeun.map(d => `<div><b>${d.hanja}</b>${d.ganZhi}<br>${d.startAge}세</div>`).join('')}</div>`;
  $('#chart').classList.remove('hidden');
}

$('#form').onsubmit = async e => {
  e.preventDefault();
  $('#error').textContent = '';
  ['#loginCta', '#readingCard'].forEach(s => $(s).classList.add('hidden'));
  const body = payload();
  saveForm(body);
  const btn = $('#submit');
  btn.disabled = true;
  btn.textContent = '계산 중…';
  try {
    const r = await fetch('/api/saju', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const s = await r.json();
    if (!r.ok) throw new Error(s.error);
    renderChart(s);
    if (dailyLimit && !user) { $('#loginCta').classList.remove('hidden'); return; }
    if (dailyLimit && usedToday) return;

    const out = $('#reading');
    reportTab = 0;
    const stopLoading = startLoading(out, 'saju');
    $('#readingCard').classList.remove('hidden');
    btn.textContent = '풀이 작성 중…';
    const res = await fetch('/api/reading', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${await token()}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) { $('#readingCard').classList.add('hidden'); throw new Error((await res.json()).error); }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let text = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        stopLoading();
        renderReport(out, text);
      }
    } catch {} // 연결이 끊기면 아래에서 안내한다
    // 마지막 섹션(한마디)까지 오지 않았으면 중간에 끊긴 것
    if (!text.includes('한마디')) {
      stopLoading();
      if (text) renderReport(out, text); else out.innerHTML = '';
      out.insertAdjacentHTML('beforeend', `<div class="card cutoff"><p>풀이가 중간에 끊겼어요. 잠시 후 다시 시도해 주세요.</p>
        <button type="button" class="primary" id="retryReading">다시 풀이 받기</button></div>`);
      $('#retryReading').onclick = () => $('#form').requestSubmit();
    }
  } catch (err) {
    $('#error').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '사주 보기';
    refreshQuota();
  }
};

restoreForm();
route();
initAuth().catch(() => { $('#loginError').textContent = '로그인 정보를 불러오지 못했어요.'; });
