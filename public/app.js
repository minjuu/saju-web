const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 콘텐츠 ----------
const YEAR = new Date().getFullYear();
const TOPICS = {
  total: { mark: '命', title: '평생 사주', desc: '타고난 성향, 재물, 직업, 관계, 대운까지 한 번에 봅니다.', color: 'c1', badge: '가장 많이 봐요' },
  year: { mark: '年', title: `${YEAR} 신년 운세`, desc: '올해의 흐름을 상·하반기와 월별로 정리합니다.', color: 'c2', badge: 'NEW' },
  love: { mark: '緣', title: '연애운', desc: '연애 성향과 잘 맞는 상대, 올해의 인연을 봅니다.', color: 'c3' },
  money: { mark: '財', title: '재물운', desc: '돈이 들어오는 방식과 지출 습관, 올해의 재물운을 봅니다.', color: 'c4' },
  career: { mark: '業', title: '직업운', desc: '적성과 강점, 잘 맞는 직무와 올해의 직업운을 봅니다.', color: 'c5' },
  people: { mark: '人', title: '대인관계운', desc: '사람을 대하는 방식과 도움이 되는 인연, 주의할 관계를 봅니다.', color: 'c6' },
};
const SLIDES = [
  { title: '어떤 운세가 궁금하세요?', sub: '타고난 성향부터 올해의 흐름까지', topic: 'total', bg: 'b1' },
  { title: `${YEAR}년, 올해의 흐름`, sub: '상반기·하반기와 월별 운세를 확인하세요', topic: 'year', bg: 'b2' },
  { title: '하루 한 번 무료 풀이', sub: '로그인하면 계정당 하루 한 번 볼 수 있습니다', topic: 'total', bg: 'b3' },
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
    $('#loginError').textContent = '로그인 기능이 아직 설정되지 않았습니다.';
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
  if (signUpMode && !data.session) $('#loginInfo').textContent = '확인 메일을 보냈습니다. 메일의 링크를 누르면 가입이 완료됩니다.';
};
function authError(e) {
  if (/Invalid login credentials/i.test(e.message)) return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (/already registered/i.test(e.message)) return '이미 가입된 이메일입니다.';
  if (/Email not confirmed/i.test(e.message)) return '이메일 인증이 완료되지 않았습니다. 받은 메일을 확인하세요.';
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
  if (!user) { usedToday = false; $('#quotaHint').textContent = '사주팔자 표는 로그인 없이 볼 수 있습니다.'; return; }
  try {
    const r = await fetch('/api/quota', { headers: { Authorization: `Bearer ${await token()}` } }).then(r => r.json());
    usedToday = !!r.usedToday;
    $('#quotaHint').textContent = usedToday ? '오늘 풀이를 이미 봤습니다. 사주팔자 표는 계속 볼 수 있습니다.' : '오늘 풀이 1회 남음';
  } catch { $('#quotaHint').textContent = ''; }
}

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
    out.innerHTML = ''; out.classList.add('loading');
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
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      out.classList.remove('loading');
      out.innerHTML = DOMPurify.sanitize(marked.parse(text));
    }
  } catch (err) {
    $('#error').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '사주 보기';
    $('#reading').classList.remove('loading');
    refreshQuota();
  }
};

restoreForm();
route();
initAuth().catch(() => { $('#loginError').textContent = '로그인 설정을 불러오지 못했습니다.'; });
