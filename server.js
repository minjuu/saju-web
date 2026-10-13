require('dotenv').config();
const express = require('express');
const { Solar, Lunar, LunarUtil } = require('lunar-javascript');
const crypto = require('crypto');
const TAROT_MEANINGS = require('./tarot-data');
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
const INSTRUCTIONS = `당신은 한국 전통 명리학에 밝은 상담가입니다. 제공된 사주 데이터(서버가 만세력으로 정확히 계산함)를 바탕으로, 읽는 사람이 "내 얘기다" 싶게 구체적으로 풀이하세요.

[근거]
- 간지, 십신, 지장간, 합·충, 대운, 세운·월운은 데이터에 적힌 것만 사용하세요. 직접 계산하거나 데이터에 없는 합·충을 만들지 마세요.
- 해석마다 사주 근거를 한 구절로 짧게 섞으세요. 예: "정화(작은 불)인 일간에 토 기운이 강해서". 전문 용어는 괄호로 쉬운 말을 붙이세요.
- 일간 자체를 십신으로 부르지 말고, 십신 이름은 데이터 표기 그대로 쓰세요.

[말투]
- 이름이 주어지면 "OO님"으로 부르고, 대화하듯 "~예요", "~거예요", "~편이에요"를 중심으로 쓰세요.
- 추상적인 말 대신 일상의 장면으로 보여주세요. 예: "약속 시간을 잘 지키고 연락 패턴이 일관된 사람에게 마음이 서서히 열리는 편이에요."
- 좋은 점만 쓰지 말고 약점과 조심할 점도 솔직하게 쓰되, 어떻게 하면 되는지까지 말해주세요.
- 단정하지 말고 "~로 읽혀요", "~일 가능성이 커요"처럼 쓰세요. 과장된 칭찬과 감성적 수사는 쓰지 마세요.
- 본문에 이모지를 가끔 써도 좋아요. 섹션당 많아야 하나, 문장 끝에만 쓰세요(예: 🌱, 🔥, 💧). 제목에는 쓰지 마세요.
- 의료·법률·투자 판단이 필요한 내용은 전문가 상담을 권하세요.

[형식 — 반드시 지키세요]
- 큰 섹션은 "## 제목", 그 안의 작은 주제는 "### 제목"으로 쓰고, 요청된 구성의 제목을 순서대로 그대로 쓰세요. 구성에서 괄호나 "—" 뒤의 설명은 쓸 내용 안내이니 제목에 넣지 마세요.
- "###" 아래에는 3~5문장짜리 문단 하나를 쓰세요. 목록이나 표는 쓰지 마세요.
- 점수 섹션은 아래처럼 코드 블록 하나로만 쓰세요. 항목마다 "이름|0~100 사이 점수|한 문장 설명" 한 줄이며, 점수는 사주 근거에 맞게 들쭉날쭉하게 주세요.
\`\`\`scores
표현력|45|말수는 적지만 깊이 있는 표현은 한 번에 전달돼요.
\`\`\`
- "## 사주토끼의 한마디"는 항상 맨 마지막 섹션이며, 이름을 부르며 시작하는 3~4문장짜리 짧은 편지로 "###" 없이 쓰세요.
- 구분선(---)은 쓰지 마세요.`;

// 홈 화면 카드별 풀이 구성
const TOPICS = {
  total: y => `## 타고난 기질 (### 한 줄 요약 — 일주 중심 핵심과 키워드 / ### 성격 / ### 강점 / ### 약점)
## 일과 돈 (### 잘 맞는 일 / ### 돈이 들어오는 방식 / ### 조심할 점)
## 사랑과 관계 (### 연애 스타일 / ### 배우자 인연 / ### 사람 관계)
## 앞으로 3년 (### ${y}년 / ### ${y + 1}년 / ### ${y + 2}년 — 각각 세운 간지를 제목에 함께, 예: "### ${y}년 병오(丙午)")
## 나의 능력치 (scores 블록, 항목: 리더십, 추진력, 끈기, 표현력, 재물 감각, 대인관계)
## 사주토끼의 한마디`,
  year: y => `## ${y}년 한눈에 (### 올해의 키워드 / ### 총평)
## 계절별 흐름 (### 봄 (1~3월) / ### 여름 (4~6월) / ### 가을 (7~9월) / ### 겨울 (10~12월) — 월운 데이터를 근거로)
## 분야별 운 (### 일 / ### 돈 / ### 연애 / ### 건강)
## 올해 운 점수 (scores 블록, 항목: 총운, 재물운, 직업운, 연애운, 건강운, 대인운)
## 주의할 시기 (### 조심할 달 / ### 이렇게 보내세요)
## 사주토끼의 한마디`,
  love: y => `## 연애 성향 (### 연애 스타일 / ### 매력 포인트 / ### 조심할 점)
## 인연 분석 (### 솔로라면 — 인연이 올 시기와 상대의 분위기·만나는 경로 / ### 연애 중이라면 — 지금 관계의 흐름)
## 올해의 연애 흐름 (### 봄 (1~3월) / ### 여름 (4~6월) / ### 가을 (7~9월) / ### 겨울 (10~12월) / ### 올해의 핵심 — 월운 데이터를 근거로)
## 반복되는 패턴 (### 무의식 패턴 / ### 반복되는 흐름 / ### 바꾸는 방법)
## 연애 능력치 (scores 블록, 항목: 표현력, 공감력, 인내심, 독립성, 헌신도, 유연성)
## 잘 맞는 사람 (### 잘 맞는 사람 / ### 안 맞는 사람 / ### 가까워지는 순간)
## 사주토끼의 한마디`,
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

  const sections = TOPICS[topic](Number(today().slice(0, 4))) + (req.body.question ? '\n## 질문에 대한 답변 (### 답변) — 사주토끼의 한마디 바로 앞에 둘 것' : '');
  await streamLLM(res, `${INSTRUCTIONS}\n\n[구성]\n${sections}`, input, () => LIMIT && refundQuota(user.id));
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
        reasoning_effort: 'low',
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

  // 맥의 로컬 모델을 먼저 쓰고, 실패하면 Gemini, 그래도 안 되면 로컬 모델을 한 번 더 시도한다
  const tryLocal = async () => {
    const r = await requestLocal(system, input, ac.signal);
    for await (const ev of sseEvents(r.body)) write(ev.choices?.[0]?.delta?.content);
  };
  const tryGemini = async () => {
    const r = await requestGemini(system, input, ac.signal);
    for await (const ev of sseEvents(r.body)) {
      for (const p of ev.candidates?.[0]?.content?.parts || []) if (!p.thought) write(p.text);
    }
  };
  const attempts = [];
  if (localAlive()) attempts.push(['로컬', tryLocal]);
  if (GEMINI_API_KEY) attempts.push(['Gemini', tryGemini]);
  if (localAlive()) attempts.push(['로컬(재시도)', tryLocal]);

  for (const [name, attempt] of attempts) {
    try {
      await attempt();
      if (wrote) return res.end();
    } catch (e) {
      if (ac.signal.aborted) return;
      console.warn(`${name} 실패:`, e.message);
      if (wrote) return res.end('\n\n풀이가 중간에 끊겼어요. 다시 시도해 주세요.');
    }
  }
  await Promise.resolve(onFail?.()).catch(() => {});
  if (!ac.signal.aborted) res.end('풀이를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
}

// ---------- 타로 ----------
const MAJOR = ['바보', '마법사', '여사제', '여황제', '황제', '교황', '연인', '전차', '힘', '은둔자', '운명의 수레바퀴',
  '정의', '매달린 사람', '죽음', '절제', '악마', '탑', '별', '달', '태양', '심판', '세계'];
const SUITS = ['완드', '컵', '소드', '펜타클'];
const RANKS = ['에이스', '2', '3', '4', '5', '6', '7', '8', '9', '10', '페이지', '나이트', '퀸', '킹'];
// 0~21 메이저, 22~77 마이너 (public/tarot.js와 같은 순서)
const DECK = [...MAJOR, ...SUITS.flatMap(s => RANKS.map(r => `${s} ${r}`))];

const SPREADS = {
  today: {
    count: 1, positions: ['오늘의 카드'], topic: '오늘 하루의 흐름',
    sections: '## 오늘의 카드 — 별 (정방향)처럼 실제 카드 이름으로 된 제목 / ## 오늘 이렇게 보내세요 (조언 2개, "- "로)',
    guide: '오늘 하루에 일어날 수 있는 일, 마음가짐, 사람을 대할 때 주의할 점을 구체적으로 짚어주세요.',
  },
  love: {
    count: 3, positions: ['나의 마음', '상대의 마음', '앞으로의 흐름'], topic: '연애와 관계',
    sections: '## 한눈에 보기 (질문에 대한 답을 먼저 2문장으로) / 카드마다 "## 나의 마음 — 연인 (정방향)"처럼 자리 이름과 카드 이름으로 된 제목 / ## 이렇게 해보세요 (조언 2개, "- "로)',
    guide: '연애 상담처럼 풀어주세요. "나의 마음"은 지금 내 감정과 태도, "상대의 마음"은 상대가 나와 이 관계를 어떻게 느끼는지(속마음), "앞으로의 흐름"은 가까운 시기(대략 1~3개월)에 관계가 어떻게 흘러갈지로 읽으세요. 연락·재회·고백·썸처럼 질문의 상황에 맞춰 신호를 구체적으로 말해주세요.',
  },
  worry: {
    count: 3, positions: ['과거', '현재', '미래'], topic: '사용자의 고민',
    sections: '## 한눈에 보기 (질문에 대한 답을 먼저 2문장으로) / 카드마다 "## 과거 — 컵 5 (역방향)"처럼 자리 이름과 카드 이름으로 된 제목 / ## 이렇게 해보세요 (조언 2개, "- "로)',
    guide: '"과거"는 지금 고민이 생긴 배경, "현재"는 지금 상황의 핵심, "미래"는 지금 흐름대로 갈 때의 가까운 결과로 읽으세요. 고민의 분야(일·관계·돈·진로 등)에 맞는 말로 풀어주세요.',
  },
};

const TAROT_INSTRUCTIONS = `당신은 상담 경험이 많은 한국 타로 상담가입니다. 뽑힌 카드로 질문한 사람의 고민에 답하세요.

[해석 원칙]
- 카드 의미는 함께 주어진 키워드를 기준으로 하세요. 그림 묘사는 쓰지 말고, 키워드에 없는 의미를 지어내지 마세요.
- 정방향은 정방향 키워드, 역방향은 역방향 키워드로 읽으세요.
- 카드마다 소제목(###, "전통적 의미", "역방향 해석" 등)을 따로 두지 말고, 카드 의미와 이 자리·질문에서의 뜻을 합쳐 2~3문장 한 문단으로만 쓰세요.
- 질문이 있으면 모든 해석을 질문에 연결하고, 질문과 상관없는 일반론은 쓰지 마세요.

[분량]
- 전체 400~700자 정도로 짧고 핵심만 쓰세요. "한눈에 보기"는 2문장, 조언은 2개만 쓰세요. 같은 말을 반복하지 마세요.

[말투]
- 상담하듯 차분한 존댓말로 쓰고 "~해요"를 중심으로 "~합니다"를 섞으세요. 쉬운 말로 쓰세요.
- 이모지는 가끔, 전체에서 두세 개만 문장 끝에 써도 좋아요. 제목에는 쓰지 마세요.
- 단정하지 말고 "~로 읽혀요", "~일 가능성이 있어요"처럼 쓰고, 나쁜 카드도 겁주지 말고 무엇을 조심하면 되는지로 풀어주세요.
- 과장된 칭찬과 감성적 수사는 쓰지 마세요. 마크다운으로 작성하세요.`;

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
타로 종류: ${sp.topic}
${question ? `질문: ${question}` : '질문: 따로 없음'}
뽑힌 카드:
${cards.map((c, i) => {
    const [up, rev] = TAROT_MEANINGS[c.id];
    return `- ${sp.positions[i]}: ${DECK[c.id]} ${c.reversed ? `역방향 (키워드: ${rev})` : `정방향 (키워드: ${up})`}`;
  }).join('\n')}`;
  await streamLLM(res, `${TAROT_INSTRUCTIONS}\n\n[이번 풀이]\n- ${sp.guide}\n- 구성: ${sp.sections}`, input);
});

app.listen(PORT, () => console.log(`사주 서버 실행: http://localhost:${PORT}`));
