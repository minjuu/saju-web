// 타로: 78장 덱에서 섞인 카드 일부를 펼쳐 놓고 사용자가 직접 고른다
(() => {
  const MAJOR = ['바보', '마법사', '여사제', '여황제', '황제', '교황', '연인', '전차', '힘', '은둔자', '운명의 수레바퀴',
    '정의', '매달린 사람', '죽음', '절제', '악마', '탑', '별', '달', '태양', '심판', '세계'];
  const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV',
    'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];
  const SUITS = [['완드', '杖'], ['컵', '杯'], ['소드', '劍'], ['펜타클', '錢']];
  const RANKS = ['에이스', '2', '3', '4', '5', '6', '7', '8', '9', '10', '페이지', '나이트', '퀸', '킹'];
  const RANK_LABEL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'P', 'N', 'Q', 'K'];
  // 서버(server.js DECK)와 같은 순서: 0~21 메이저, 22~77 마이너
  const DECK = [
    ...MAJOR.map((name, i) => ({ name, top: ROMAN[i], glyph: ROMAN[i], major: true })),
    ...SUITS.flatMap(([suit, glyph]) => RANKS.map((r, i) => ({ name: `${suit} ${r}`, top: RANK_LABEL[i], glyph }))),
  ];

  const SPREADS = {
    today: { mark: '今', title: '오늘의 타로', desc: '카드 한 장으로 오늘의 흐름을 봅니다.', color: 'c7',
      positions: ['오늘의 카드'], ask: false },
    love: { mark: '心', title: '연애 타로', desc: '나의 마음, 상대의 마음, 앞으로의 흐름을 세 장으로 봅니다.', color: 'c3',
      positions: ['나의 마음', '상대의 마음', '앞으로의 흐름'], ask: true, placeholder: '예) 그 사람과 다시 연락이 될까요?' },
    worry: { mark: '問', title: '고민 타로', desc: '고민을 적고 과거·현재·미래 세 장을 뽑습니다.', color: 'c2',
      positions: ['과거', '현재', '미래'], ask: true, required: true, placeholder: '예) 지금 회사를 계속 다녀야 할까요?' },
  };
  const SHOWN = 24; // 펼쳐 놓는 카드 수

  const $ = s => document.querySelector(s);
  $('#tarotCards').innerHTML = Object.entries(SPREADS).map(([key, t]) => `
    <a class="topic-card ${t.color}" href="#/tarot/${key}">
      <div class="topic-top"><span class="topic-glyph">${t.mark}</span><em>${t.positions.length}장</em></div>
      <b>${t.title}</b><p>${t.desc}</p><span class="go">뽑기 →</span>
    </a>`).join('');

  let spread, picked, shown, busy = false, justPicked = -1;

  function shuffle() {
    const ids = DECK.map((_, i) => i);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    shown = ids.slice(0, SHOWN).map(id => ({ id, reversed: crypto.getRandomValues(new Uint8Array(1))[0] < 128 }));
    picked = [];
    render();
    animateShuffle();
    $('#tarotResultCard').classList.add('hidden');
    $('#tarotError').textContent = '';
  }

  // 카드 이미지: Rider-Waite-Smith (1909, 퍼블릭 도메인) — Wikimedia Commons
  // 섞는 모습: 카드가 가운데로 모였다가 좌우로 엇갈려 섞인 뒤 한 장씩 제자리로 돌아간다
  let shuffling = false;
  function animateShuffle() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const deck = $('#deck');
    const cards = [...deck.children];
    const d = deck.getBoundingClientRect();
    if (!d.width) return; // 화면에 안 보이는 상태
    const cx = d.left + d.width / 2, cy = d.top + d.height / 2;
    shuffling = true;
    let done = 0;
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
      const side = (i % 2 ? 1 : -1) * (28 + Math.random() * 26);
      const rot = (Math.random() - 0.5) * 24;
      const at = (x, y, deg) => `translate(${x}px, ${y}px) rotate(${deg}deg)`;
      const anim = c.animate([
        { transform: at(dx, dy, 0), offset: 0 },
        { transform: at(dx + side, dy - 4, rot), offset: 0.18 },
        { transform: at(dx - side, dy + 4, -rot), offset: 0.36 },
        { transform: at(dx + side / 2, dy, rot / 2), offset: 0.5 },
        { transform: at(dx, dy, 0), offset: 0.6 },
        { transform: 'none', offset: 1 },
      ], { duration: 1300 + i * 22, easing: 'ease-in-out' });
      anim.onfinish = anim.oncancel = () => { if (++done === cards.length) shuffling = false; };
    });
  }

  const face = c => `<div class="tc-face${c.reversed ? ' rev' : ''}"><img src="/tarot/${c.id}.jpg" alt="${DECK[c.id].name}"></div>`;

  function render() {
    const sp = SPREADS[spread];
    $('#slots').innerHTML = sp.positions.map((pos, i) => {
      const c = picked[i];
      return `<div class="slot">
        <div class="tcard${c ? ' flipped' : ''}${i === justPicked ? ' anim' : ''}"><div class="tc-back"></div>${c ? face(c) : ''}</div>
        <span class="slot-label">${pos}</span>
        ${c ? `<span class="slot-name">${DECK[c.id].name}${c.reversed ? ' (역)' : ''}</span>` : ''}
      </div>`;
    }).join('');
    $('#slots').style.setProperty('--n', sp.positions.length);
    const left = sp.positions.length - picked.length;
    $('#tarotGuide').textContent = left ? `아래에서 카드 ${left}장을 고르세요.` : '카드를 모두 골랐습니다.';
    $('#deck').innerHTML = shown.map((c, i) =>
      `<button type="button" class="dcard${picked.includes(c) ? ' gone' : ''}" data-i="${i}" aria-label="카드 ${i + 1}" ${left ? '' : 'disabled'}></button>`).join('');
    $('#tarotGo').disabled = !!left || busy;
    justPicked = -1;
  }

  $('#deck').onclick = e => {
    const b = e.target.closest('.dcard');
    if (!b || busy || shuffling) return;
    const c = shown[b.dataset.i];
    if (picked.includes(c) || picked.length >= SPREADS[spread].positions.length) return;
    picked.push(c);
    justPicked = picked.length - 1;
    render();
  };
  $('#reshuffle').onclick = () => { if (!busy && !shuffling) shuffle(); };

  $('#tarotGo').onclick = async () => {
    const sp = SPREADS[spread];
    const question = $('#tarotQ').value.trim();
    $('#tarotError').textContent = '';
    if (sp.required && !question) { $('#tarotError').textContent = '고민을 먼저 적어주세요.'; $('#tarotQ').focus(); return; }
    busy = true;
    $('#tarotGo').disabled = true;
    $('#tarotGo').textContent = '풀이 작성 중…';
    const out = $('#tarotResult');
    const stopLoading = startLoading(out, 'tarot');
    $('#tarotResultCard').classList.remove('hidden');
    try {
      const res = await fetch('/api/tarot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spread, question, cards: picked.map(({ id, reversed }) => ({ id, reversed })) }),
      });
      if (!res.ok) { $('#tarotResultCard').classList.add('hidden'); throw new Error((await res.json()).error); }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let text = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        stopLoading();
        out.innerHTML = DOMPurify.sanitize(marked.parse(text));
      }
    } catch (err) {
      $('#tarotError').textContent = err.message;
    } finally {
      busy = false;
      stopLoading();
      $('#tarotGo').textContent = '풀이 보기';
      render();
    }
  };

  // app.js 라우터에서 호출. 알 수 없는 종류면 false
  window.openTarot = key => {
    const sp = SPREADS[key];
    if (!sp) return false;
    spread = key;
    $('#tarotMark').textContent = sp.mark;
    $('#tarotMark').className = `topic-mark ${sp.color}`;
    $('#tarotTitle').textContent = sp.title;
    $('#tarotDesc').textContent = sp.desc;
    $('#tarotQWrap').classList.toggle('hidden', !sp.ask);
    $('#tarotQ').value = '';
    $('#tarotQ').placeholder = sp.placeholder || '';
    shuffle();
    requestAnimationFrame(() => requestAnimationFrame(animateShuffle)); // 화면이 보인 뒤 섞는 모습을 보여준다
    return true;
  };
  if (location.hash.startsWith('#/tarot/')) window.dispatchEvent(new HashChangeEvent('hashchange'));
})();
