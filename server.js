require('dotenv').config();
const express = require('express');
const { Solar, Lunar, LunarUtil } = require('lunar-javascript');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const {
  PORT = 3000,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-flash-lite-latest',
  GEMINI_FALLBACK_MODEL = 'gemini-flash-latest',
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  AUTH_PROVIDERS = 'kakao,google,email',
  DAILY_LIMIT_ENABLED = 'false', // 'true'면 로그인 필수 + 계정당 하루 1회
  // 맥의 로컬 모델(local-llm/agent.js) 비밀 키의 SHA-256. 키 자체는 서버에 두지 않고,
  // agent가 등록할 때 보내는 키를 이 값과 비교한 뒤 그 키로 터널에 요청한다
  LOCAL_LLM_SECRET_SHA256 = 'f4709281f4953afc18ac1ee69295b53ebd69c9b2e098785a6ee02cfaf3614da4',
  LOCAL_LLM_MODEL = 'gpt-oss:20b',
} = process.env;
const LIMIT = DAILY_LIMIT_ENABLED === 'true';

if (!GEMINI_API_KEY) console.warn('GEMINI_API_KEY 미설정: 맥의 로컬 모델이 연결됐을 때만 풀이가 됩니다.');
// 서버 전용 클라이언트: 로그인 토큰 검증과 사용 기록(reading_usage) 관리에 쓴다
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;
if (!supabase || !SUPABASE_ANON_KEY) console.warn('Supabase 미설정: 로그인과 풀이를 사용할 수 없습니다.');

const app = express();

app.use(express.json());
app.use(express.static('public'));

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

// ---------- 사주 계산 ----------
const KO = {
  甲: '갑', 乙: '을', 丙: '병', 丁: '정', 戊: '무', 己: '기', 庚: '경', 辛: '신', 壬: '임', 癸: '계',
  子: '자', 丑: '축', 寅: '인', 卯: '묘', 辰: '진', 巳: '사', 午: '오', 未: '미', 申: '신', 酉: '유', 戌: '술', 亥: '해',
};
const ELEMENT = {
  甲: '목', 乙: '목', 丙: '화', 丁: '화', 戊: '토', 己: '토', 庚: '금', 辛: '금', 壬: '수', 癸: '수',
  寅: '목', 卯: '목', 巳: '화', 午: '화', 辰: '토', 戌: '토', 丑: '토', 未: '토', 申: '금', 酉: '금', 亥: '수', 子: '수',
};
const TEN_GODS = {
  比肩: '비견', 劫财: '겁재', 食神: '식신', 伤官: '상관', 偏财: '편재',
  正财: '정재', 七杀: '편관', 正官: '정관', 偏印: '편인', 正印: '정인', 日主: '일간',
};
const ko = s => [...s].map(c => KO[c] || c).join('');

function pillar(ganZhi, ganGod, zhiGods) {
  const [g, z] = [...ganZhi];
  const hidden = LunarUtil.ZHI_HIDE_GAN[z];
  return {
    hanja: ganZhi,
    korean: ko(ganZhi),
    stem: { hanja: g, korean: KO[g], element: ELEMENT[g], tenGod: TEN_GODS[ganGod] || ganGod },
    branch: { hanja: z, korean: KO[z], element: ELEMENT[z], tenGod: TEN_GODS[zhiGods[0]] || zhiGods[0] },
    // 지장간: 지지 속에 숨은 천간 (첫 번째가 본기)
    hiddenStems: hidden.map((h, i) => `${h}${KO[h]}${ELEMENT[h]}(${TEN_GODS[zhiGods[i]] || zhiGods[i]})`).join(', '),
  };
}

// 일간 기준 십신
const tenGodOf = (dayStem, stem) => TEN_GODS[LunarUtil.SHI_SHEN[dayStem + stem]] || '';
const STEMS = '甲乙丙丁戊己庚辛壬癸';
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const yearGanZhi = y => STEMS[(y - 4) % 10] + BRANCHES[(y - 4) % 12];

// 지지 사이의 충·합 (원국끼리, 또는 운에서 들어오는 지지와 원국 사이)
const CHUNG = ['子午', '丑未', '寅申', '卯酉', '辰戌', '巳亥'];
const YUKHAP = ['子丑', '寅亥', '卯戌', '辰酉', '巳申', '午未'];
const SAMHAP = [['申子辰', '수'], ['亥卯未', '목'], ['寅午戌', '화'], ['巳酉丑', '금']];
const PILLAR_KO = { year: '년지', month: '월지', day: '일지', time: '시지' };
const pairIn = (list, a, b) => list.find(p => p === a + b || p === b + a);
function natalRelations(pillars) {
  const bs = Object.entries(pillars).filter(([, p]) => p).map(([k, p]) => [PILLAR_KO[k], p.branch.hanja]);
  const out = [];
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const [[n1, a], [n2, b]] = [bs[i], bs[j]];
    { const p = pairIn(CHUNG, a, b); if (p) out.push(`${n1} ${a}${KO[a]}와 ${n2} ${b}${KO[b]}의 ${p}충`); }
    { const p = pairIn(YUKHAP, a, b); if (p) out.push(`${n1} ${a}${KO[a]}와 ${n2} ${b}${KO[b]}의 ${p}합(육합)`); }
  }
  const set = new Set(bs.map(([, b]) => b));
  for (const [three, el] of SAMHAP) {
    const have = [...three].filter(c => set.has(c));
    if (have.length === 3) out.push(`${three} 삼합 ${el}국 성립`);
    else if (have.length === 2 && have.includes(three[1])) out.push(`${have.join('')} 반합(${three} 삼합 ${el}국의 일부)`);
  }
  return out;
}
function incomingRelations(pillars, branch) {
  const out = [];
  for (const [k, p] of Object.entries(pillars)) {
    if (!p) continue;
    const b = p.branch.hanja;
    { const p = pairIn(CHUNG, branch, b); if (p) out.push(`${PILLAR_KO[k]} ${b}${KO[b]}와 ${p}충`); }
    { const p = pairIn(YUKHAP, branch, b); if (p) out.push(`${PILLAR_KO[k]} ${b}${KO[b]}와 ${p}합`); }
  }
  const set = new Set(Object.values(pillars).filter(Boolean).map(p => p.branch.hanja));
  for (const [three, el] of SAMHAP) {
    if (three.includes(branch) && [...three].every(c => c === branch || set.has(c))) out.push(`원국과 ${three} 삼합 ${el}국 완성`);
  }
  return out;
}

function computeSaju({ calendar, year, month, day, hour, minute, timeUnknown, leapMonth, gender }) {
  const h = timeUnknown ? 12 : hour;
  const mi = timeUnknown ? 0 : minute;
  const lunar = calendar === 'lunar'
    ? Lunar.fromYmdHms(year, leapMonth ? -month : month, day, h, mi, 0)
    : Solar.fromYmdHms(year, month, day, h, mi, 0).getLunar();
  const solar = lunar.getSolar();
  const ec = lunar.getEightChar();

  const pillars = {
    year: pillar(ec.getYear(), ec.getYearShiShenGan(), ec.getYearShiShenZhi()),
    month: pillar(ec.getMonth(), ec.getMonthShiShenGan(), ec.getMonthShiShenZhi()),
    day: pillar(ec.getDay(), '日主', ec.getDayShiShenZhi()),
    time: timeUnknown ? null : pillar(ec.getTime(), ec.getTimeShiShenGan(), ec.getTimeShiShenZhi()),
  };

  const elements = { 목: 0, 화: 0, 토: 0, 금: 0, 수: 0 };
  for (const p of Object.values(pillars)) {
    if (!p) continue;
    elements[p.stem.element]++;
    elements[p.branch.element]++;
  }

  const yun = ec.getYun(gender === 'male' ? 1 : 0);
  const daeun = yun.getDaYun().slice(1, 9).map(d => ({
    ganZhi: ko(d.getGanZhi()), hanja: d.getGanZhi(), startAge: d.getStartAge(), startYear: d.getStartYear(),
  }));

  const dayStem = pillars.day.stem.hanja;
  const thisYear = Number(today().slice(0, 4));
  const describe = gz => {
    const [g, z] = [...gz];
    return `${gz}(${ko(gz)}) — 천간 ${g}${ELEMENT[g]} ${tenGodOf(dayStem, g)}, 지지 ${z}${ELEMENT[z]} ${tenGodOf(dayStem, LunarUtil.ZHI_HIDE_GAN[z][0])}`;
  };
  // 세운: 올해부터 3년
  const yearlyLuck = [0, 1, 2].map(i => {
    const y = thisYear + i, gz = yearGanZhi(y);
    return { year: y, ganZhi: describe(gz), relations: incomingRelations(pillars, gz[1]) };
  });
  // 올해 월운: 절기 기준 각 달의 간지 (양력 15일 기준)
  const monthlyLuck = Array.from({ length: 12 }, (_, i) => {
    const gz = Solar.fromYmd(thisYear, i + 1, 15).getLunar().getMonthInGanZhiExact();
    return { month: i + 1, ganZhi: describe(gz), relations: incomingRelations(pillars, gz[1]) };
  });
  const age = thisYear - solar.getYear() + 1;
  const current = daeun.filter(d => d.startAge <= age).pop();

  return {
    solarDate: solar.toYmd(),
    lunarDate: `${lunar.getYear()}-${lunar.getMonth() < 0 ? '윤' : ''}${Math.abs(lunar.getMonth())}-${lunar.getDay()}`,
    dayMaster: `${pillars.day.stem.korean}${pillars.day.stem.element}(${pillars.day.stem.hanja})`,
    pillars, elements, daeun, timeUnknown: !!timeUnknown, gender,
    relations: natalRelations(pillars),
    currentDaeun: current ? `${current.hanja}(${current.ganZhi}) 대운, ${current.startAge}세부터` : '대운 시작 전',
    koreanAge: age,
    yearlyLuck, monthlyLuck,
  };
}

function validate(b) {
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!['solar', 'lunar'].includes(b.calendar)) return '양력/음력을 선택하세요';
  if (!['male', 'female'].includes(b.gender)) return '성별을 선택하세요';
  if (!int(b.year, 1900, 2100) || !int(b.month, 1, 12) || !int(b.day, 1, 31)) return '생년월일을 확인하세요';
  if (!b.timeUnknown && (!int(b.hour, 0, 23) || !int(b.minute, 0, 59))) return '태어난 시간을 확인하세요';
  if (b.question && (typeof b.question !== 'string' || b.question.length > 300)) return '질문은 300자 이내로 입력하세요';
  if (b.topic && !TOPICS[b.topic]) return '알 수 없는 풀이 종류입니다';
  if (b.name && (typeof b.name !== 'string' || b.name.length > 10)) return '이름은 10자 이내로 입력하세요';
  return null;
}

app.post('/api/saju', (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });
  try {
    res.json(computeSaju(req.body));
  } catch {
    res.status(400).json({ error: '존재하지 않는 날짜입니다' });
  }
});

// ---------- AI 풀이 (Gemini, 스트리밍) ----------
const INSTRUCTIONS = `당신은 한국 전통 명리학에 밝은 상담가입니다. 제공된 사주 데이터(서버가 만세력으로 정확히 계산함)를 바탕으로 풀이하세요.

[근거]
- 간지, 십신, 지장간, 합·충, 세운·월운은 데이터에 적힌 것만 사용하세요. 직접 계산하거나 데이터에 없는 합·충을 만들지 마세요.
- 일간(본인)을 중심으로, 어느 기둥의 어떤 글자·십신 때문에 그렇게 읽는지 근거를 먼저 밝히고 해석을 이어가세요.
- 일간 자체를 십신으로 부르지 말고, 십신 이름은 데이터 표기 그대로 쓰세요.

[말투]
- 차분한 존댓말로 쓰고 "~합니다"와 "~해요"를 자연스럽게 섞으세요. 이름이 주어지면 "OO님"으로 부르세요.
- 전문 용어는 처음 나올 때 한자와 쉬운 설명을 붙이세요. 예: 정화(丁火)는 태양처럼 넓게 비추는 불이 아니라 촛불처럼 한곳을 비추는 불이에요.
- 단정하지 말고 "~로 해석합니다", "~로 읽기도 해요"처럼 전통 해석임을 드러내세요.
- 좋은 점만 쓰지 말고 과제와 주의점도 균형 있게 쓰고, 오해할 만한 부분은 "반드시 ~라는 뜻은 아니에요"처럼 짚어주세요.
- 이모지, 과장된 칭찬, 감성적 수사는 쓰지 마세요. 문단은 짧게, 나열은 "- "로 쓰세요.
- 의료·법률·투자 판단이 필요한 내용은 전문가 상담을 권하세요.

[형식]
- 요청된 구성의 제목(##)을 순서대로 그대로 쓰고, 마크다운으로 작성하세요.
- 첫 섹션 끝에 핵심 키워드 3~5개를 **굵게** 한 줄로 정리하세요.
- 연도·월별 흐름은 마크다운 표(| 연도 | 세운 | 해석 |)로 쓰세요.
- 마지막 "종합적으로 보면"은 두세 문단으로 전체를 정리하세요.`;

// 홈 화면 카드별 풀이 구성
const TOPICS = {
  total: y => `## 1. 타고난 사주팔자 (일주 중심의 핵심 요약) / ## 2. 성격과 타고난 기질 / ## 3. 직업운과 재물운 / ## 4. 연애운과 결혼운 / ## 5. ${y}~${y + 2}년 운의 흐름 (세운 표) / ## 종합적으로 보면`,
  year: y => `## 1. ${y}년 세운 한눈에 보기 / ## 2. 상반기 흐름 / ## 3. 하반기 흐름 / ## 4. 월별 흐름 (1~12월 월운 표: | 월 | 월운 | 해석 |) / ## 5. 올해 주의할 점 / ## 종합적으로 보면`,
  love: y => `## 1. 연애 성향 / ## 2. 배우자 별로 보는 인연 (여성은 관성, 남성은 재성 중심) / ## 3. 잘 맞는 상대 / ## 4. ${y}~${y + 2}년 연애·결혼운 (세운 표) / ## 종합적으로 보면`,
};

// 혼잡(503)·한도(429) 응답이면 잠시 후 재시도하고, 그래도 안 되면 대체 모델로 넘어간다
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function requestGemini(system, input, signal) {
  let last;
  for (const model of [GEMINI_MODEL, GEMINI_FALLBACK_MODEL]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await sleep(2000);
      // 혼잡할 때 응답 없이 멈추는 경우가 있어 20초 안에 응답이 시작되지 않으면 끊고 다음 시도로 넘어간다
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 20000);
      let r;
      try {
        r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: input }] }],
          }),
          signal: AbortSignal.any([signal, timeout.signal]),
        },
        );
      } catch (e) {
        if (signal.aborted || !timeout.signal.aborted) throw e;
        last = Object.assign(new Error(`${model} 응답 시간 초과`), { busy: true });
        console.warn(`Gemini ${model} 시간 초과, 다음 모델로`);
        break;
      } finally {
        clearTimeout(timer); // 응답이 시작된 뒤에는 스트리밍이 길어져도 끊지 않는다
      }
      if (r.ok) return r;
      last = Object.assign(new Error(`${model} ${r.status} ${await r.text()}`), { busy: [429, 503].includes(r.status) });
      if (!last.busy) throw last;
      console.warn(`Gemini ${model} ${r.status}, 재시도`);
    }
  }
  throw last;
}

// ---------- 로그인 · 계정당 하루 1회 ----------
// reading_usage 테이블의 (user_id, day) 기본키로 하루 1회를 보장한다 (supabase/schema.sql)
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: SUPABASE_URL || null,
    supabaseAnonKey: SUPABASE_ANON_KEY || null,
    providers: AUTH_PROVIDERS.split(',').map(p => p.trim()).filter(Boolean),
    dailyLimit: LIMIT,
  });
});

async function getUser(req) {
  const token = req.get('authorization')?.replace(/^Bearer /, '');
  if (!supabase || !token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user;
}

async function usedToday(userId) {
  const { data, error } = await supabase.from('reading_usage').select('user_id').eq('user_id', userId).eq('day', today()).maybeSingle();
  if (error) throw error;
  return !!data;
}

async function claimQuota(userId) {
  const { error } = await supabase.from('reading_usage').insert({ user_id: userId, day: today() });
  if (!error) return true;
  if (error.code === '23505') return false; // 오늘 이미 사용
  throw error;
}

async function refundQuota(userId) {
  await supabase.from('reading_usage').delete().eq('user_id', userId).eq('day', today());
}

app.get('/api/quota', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다' });
  try {
    res.json({ usedToday: await usedToday(user.id) });
  } catch (e) {
    console.error('quota 조회 오류:', e.message);
    res.status(500).json({ error: '사용 기록을 확인하지 못했습니다' });
  }
});

app.post('/api/reading', async (req, res) => {
  if ((!GEMINI_API_KEY && !localAlive()) || (LIMIT && !supabase)) return res.status(503).json({ error: '지금은 풀이를 볼 수 없습니다. 서버 설정을 확인하세요.' });
  const user = LIMIT ? await getUser(req) : null;
  if (LIMIT && !user) return res.status(401).json({ error: '풀이는 로그인 후 볼 수 있습니다' });
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });
  const topic = req.body.topic || 'total';

  let saju;
  try { saju = computeSaju(req.body); } catch { return res.status(400).json({ error: '존재하지 않는 날짜입니다' }); }
  if (LIMIT) try {
    if (!(await claimQuota(user.id))) return res.status(429).json({ error: '풀이는 계정당 하루 한 번만 볼 수 있습니다. 내일 다시 이용해 주세요.' });
  } catch (e) {
    console.error('quota 기록 오류:', e.message);
    return res.status(500).json({ error: '사용 기록을 저장하지 못했습니다' });
  }

  const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 10) : '';
  const input = `오늘 날짜: ${today()}
${name ? `이름: ${name}\n` : ''}사주 데이터:
${JSON.stringify(saju, null, 2)}
${req.body.question ? `\n사용자 질문: ${req.body.question}` : ''}`;

  const sections = TOPICS[topic](Number(today().slice(0, 4))) + (req.body.question ? ' / ## 질문에 대한 답변' : '');
  await streamLLM(res, `${INSTRUCTIONS}\n- 구성: ${sections}`, input, () => LIMIT && refundQuota(user.id));
});

// ---------- 로컬 모델 (맥의 gpt-oss) ----------
// 맥의 agent.js가 1분마다 터널 주소를 등록한다. 3분 넘게 소식이 없으면 꺼진 것으로 본다
let localLLM = null; // { url, secret, at }
const EXPECTED = Buffer.from(LOCAL_LLM_SECRET_SHA256, 'hex');
const sameSecret = v => typeof v === 'string' && v.length > 0 && EXPECTED.length === 32
  && crypto.timingSafeEqual(crypto.createHash('sha256').update(v).digest(), EXPECTED);
app.post('/api/llm/register', (req, res) => {
  const secret = req.get('x-llm-secret');
  if (!sameSecret(secret)) return res.status(403).end();
  const url = req.body?.url;
  if (typeof url !== 'string' || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url)) return res.status(400).end();
  if (localLLM?.url !== url) console.log('로컬 모델 연결:', url);
  localLLM = { url, secret, at: Date.now() };
  res.json({ ok: true });
});
const localAlive = () => localLLM && Date.now() - localLLM.at < 3 * 60 * 1000;

async function requestLocal(system, input, signal) {
  // 맥에서 모델을 메모리에 올리거나 다른 풀이를 처리 중이면 시작이 늦을 수 있어 60초까지 기다린다
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 60000);
  try {
    const r = await fetch(`${localLLM.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-llm-secret': localLLM.secret },
      body: JSON.stringify({
        model: LOCAL_LLM_MODEL,
        stream: true,
        reasoning_effort: 'medium',
        messages: [{ role: 'system', content: system }, { role: 'user', content: input }],
      }),
      signal: AbortSignal.any([signal, timeout.signal]),
    });
    if (!r.ok) throw new Error(`로컬 모델 ${r.status}`);
    return r;
  } finally {
    clearTimeout(timer);
  }
}

// SSE 응답에서 "data: {...}" 줄을 하나씩 꺼낸다
async function* sseEvents(body) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ') || line.startsWith('data: [DONE]')) continue;
      yield JSON.parse(line.slice(6));
    }
  }
}

// 맥의 로컬 모델 → Gemini 순서로 시도해 응답을 텍스트 스트림으로 흘려보낸다. 실패하면 onFail(횟수 복구 등)을 부른다
async function streamLLM(res, system, input, onFail) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  let wrote = false;
  const write = t => { if (t) { wrote = true; res.write(t); } };

  if (localAlive()) {
    try {
      const r = await requestLocal(system, input, ac.signal);
      for await (const ev of sseEvents(r.body)) write(ev.choices?.[0]?.delta?.content);
      if (wrote) return res.end();
    } catch (e) {
      if (ac.signal.aborted) return;
      console.warn('로컬 모델 실패, Gemini로 전환:', e.message);
      if (wrote) return res.end('\n\n풀이가 중간에 끊겼습니다. 다시 시도하세요.');
    }
  }

  try {
    if (!GEMINI_API_KEY) throw Object.assign(new Error('사용 가능한 모델 없음'), { busy: true });
    const r = await requestGemini(system, input, ac.signal);
    for await (const ev of sseEvents(r.body)) {
      for (const p of ev.candidates?.[0]?.content?.parts || []) if (!p.thought) write(p.text);
    }
    res.end();
  } catch (e) {
    await Promise.resolve(onFail?.()).catch(() => {});
    if (ac.signal.aborted) return;
    console.error('Gemini 오류:', e.message);
    res.end(e.busy
      ? '\n\n지금 이용자가 많아 풀이를 작성하지 못했습니다. 잠시 후 다시 시도하세요.'
      : '\n\n풀이 작성 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.');
  }
}

// ---------- 타로 ----------
const MAJOR = ['바보', '마법사', '여사제', '여황제', '황제', '교황', '연인', '전차', '힘', '은둔자', '운명의 수레바퀴',
  '정의', '매달린 사람', '죽음', '절제', '악마', '탑', '별', '달', '태양', '심판', '세계'];
const SUITS = ['완드', '컵', '소드', '펜타클'];
const RANKS = ['에이스', '2', '3', '4', '5', '6', '7', '8', '9', '10', '페이지', '나이트', '퀸', '킹'];
// 0~21 메이저, 22~77 마이너 (public/tarot.js와 같은 순서)
const DECK = [...MAJOR, ...SUITS.flatMap(s => RANKS.map(r => `${s} ${r}`))];

const SPREADS = {
  today: { count: 1, positions: ['오늘의 카드'], frame: '오늘 하루의 흐름과 조언' },
  love: { count: 3, positions: ['나의 마음', '상대 또는 인연의 상황', '앞으로의 흐름'], frame: '연애와 관계' },
  worry: { count: 3, positions: ['과거', '현재', '미래'], frame: '사용자의 고민' },
};

const TAROT_INSTRUCTIONS = `당신은 경험 많은 타로 상담가입니다. 뽑힌 카드와 자리, 정/역방향을 바탕으로 질문한 사람이 읽고 바로 이해할 수 있게 깊이 있게 풀이하세요.

[카드마다]
- 제목은 "## 자리 — 카드 이름 (정방향/역방향)" 형식으로 쓰세요.
- 먼저 카드 그림에 무엇이 그려져 있는지 한두 문장으로 묘사하고(라이더-웨이트 덱 기준), 그 그림이 전통적으로 무엇을 뜻하는지 설명하세요.
- 역방향이면 정방향 의미가 어떻게 막히거나 뒤집히거나 안으로 향하는지 구체적으로 설명하세요.
- 이 카드가 이 자리에 나온 것이 질문한 사람의 상황에서 무엇을 말하는지, 실제 생활의 예를 들어 풀어주세요. 질문이 있으면 질문과 직접 연결하세요.
- 카드마다 두세 문단으로 충분히 쓰세요.

[전체]
- "## 카드들이 함께 말하는 것"에서 카드 사이의 흐름과 연결(예: 앞 카드의 막힘이 뒤 카드에서 어떻게 풀리는지)을 설명하세요. 카드가 한 장이면 이 섹션은 오늘 하루의 흐름으로 쓰세요.
- "## 조언"에서 지금 해볼 수 있는 구체적인 행동 두세 가지를 "- "로 정리하세요.
- 마지막 "## 한 줄 요약"에 핵심을 한 문장으로 쓰세요.

[말투]
- 차분한 존댓말로 쓰고 "~합니다"와 "~해요"를 자연스럽게 섞으세요. 어려운 용어 없이 쉬운 말로 쓰세요.
- 단정적인 예언 대신 "~로 읽을 수 있어요", "~를 뜻하기도 해요"처럼 쓰고, 오해할 만한 부분은 "반드시 ~라는 뜻은 아니에요"처럼 짚어주세요.
- 이모지, 과장된 칭찬, 감성적 수사는 쓰지 마세요. 의료·법률·투자 판단이 필요한 내용은 전문가 상담을 권하세요. 마크다운으로 작성하세요.`;

app.post('/api/tarot', async (req, res) => {
  if (!GEMINI_API_KEY && !localAlive()) return res.status(503).json({ error: '지금은 풀이를 볼 수 없습니다. 서버 설정을 확인하세요.' });
  const { spread, question, cards } = req.body || {};
  const sp = SPREADS[spread];
  if (!sp) return res.status(400).json({ error: '알 수 없는 타로 종류입니다' });
  if (question && (typeof question !== 'string' || question.length > 300)) return res.status(400).json({ error: '질문은 300자 이내로 입력하세요' });
  if (!Array.isArray(cards) || cards.length !== sp.count
    || cards.some(c => !Number.isInteger(c?.id) || !DECK[c.id] || typeof c.reversed !== 'boolean')
    || new Set(cards.map(c => c.id)).size !== cards.length) return res.status(400).json({ error: '카드를 다시 뽑아주세요' });

  const input = `오늘 날짜: ${today()}
주제: ${sp.frame}
${question ? `질문: ${question}\n` : ''}뽑힌 카드:
${cards.map((c, i) => `- ${sp.positions[i]}: ${DECK[c.id]} (${c.reversed ? '역방향' : '정방향'})`).join('\n')}`;
  await streamLLM(res, TAROT_INSTRUCTIONS, input);
});

app.listen(PORT, () => console.log(`사주 서버 실행: http://localhost:${PORT}`));
