require('dotenv').config();
const express = require('express');
const { Solar, Lunar } = require('lunar-javascript');
const { createClient } = require('@supabase/supabase-js');

const {
  PORT = 3000,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-flash-latest',
  GEMINI_FALLBACK_MODEL = 'gemini-flash-lite-latest',
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  AUTH_PROVIDERS = 'kakao,google,email',
  DAILY_LIMIT_ENABLED = 'false', // 'true'면 로그인 필수 + 계정당 하루 1회
} = process.env;
const LIMIT = DAILY_LIMIT_ENABLED === 'true';

if (!GEMINI_API_KEY) console.warn('GEMINI_API_KEY 미설정: 만세력만 사용할 수 있습니다.');
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
  return {
    hanja: ganZhi,
    korean: ko(ganZhi),
    stem: { hanja: g, korean: KO[g], element: ELEMENT[g], tenGod: TEN_GODS[ganGod] || ganGod },
    branch: { hanja: z, korean: KO[z], element: ELEMENT[z], tenGod: TEN_GODS[zhiGods[0]] || zhiGods[0] },
  };
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

  return {
    solarDate: solar.toYmd(),
    lunarDate: `${lunar.getYear()}-${lunar.getMonth() < 0 ? '윤' : ''}${Math.abs(lunar.getMonth())}-${lunar.getDay()}`,
    dayMaster: `${pillars.day.stem.korean}${pillars.day.stem.element}(${pillars.day.stem.hanja})`,
    pillars, elements, daeun, timeUnknown: !!timeUnknown, gender,
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
const INSTRUCTIONS = `당신은 30년 경력의 한국 명리학자입니다. 제공된 사주팔자 데이터(이미 정확히 계산됨)를 바탕으로 풀이하세요.
- 계산 결과를 다시 계산하거나 바꾸지 말고 그대로 사용하세요.
- 일간의 강약, 오행의 균형, 십신 구성, 용신(추정)을 근거로 설명하세요.
- 요청된 구성의 제목(##)을 그대로 쓰고, 사용자 질문이 있으면 마지막에 ## 질문에 대한 답변을 추가하세요.
- 담백한 존댓말(~합니다)로 간결하게 쓰세요. 감성적 수사, 이모지, 과장된 위로·칭찬은 쓰지 마세요.
- 근거(오행·십신)를 짧게 밝히고 구체적으로 쓰되, 단정적인 공포 조장은 피하세요. 마크다운으로 작성하세요.
- 의료·법률·투자 판단은 전문가 상담을 권하세요.`;

// 홈 화면 카드별 풀이 구성
const TOPICS = {
  total: '## 타고난 성향 / ## 오행 균형과 보완법 / ## 재물운 / ## 직업·적성 / ## 연애·관계 / ## 건강 / ## 대운 흐름 / ## 올해의 운세',
  year: `## ${new Date().getFullYear()}년 총운 / ## 상반기 / ## 하반기 / ## 월별 흐름(1~12월, 각 한두 문장) / ## 주의할 점`,
  love: '## 연애 성향 / ## 잘 맞는 상대 / ## 관계에서 주의할 점 / ## 올해의 연애운',
  money: '## 재물 성향 / ## 돈이 들어오는 방식 / ## 지출·투자 습관 / ## 올해의 재물운',
  career: '## 적성과 강점 / ## 잘 맞는 직무·업종 / ## 일하는 방식 / ## 올해의 직업운',
  people: '## 대인관계 성향 / ## 도움이 되는 인연 / ## 주의할 관계 / ## 가족·동료와의 관계 / ## 올해의 대인관계운',
};

// 혼잡(503)·한도(429) 응답이면 잠시 후 재시도하고, 그래도 안 되면 대체 모델로 넘어간다
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function requestGemini(input, topic, signal) {
  let last;
  for (const model of [GEMINI_MODEL, GEMINI_FALLBACK_MODEL]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await sleep(2000);
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: `${INSTRUCTIONS}\n- 구성: ${TOPICS[topic]}` }] },
            contents: [{ role: 'user', parts: [{ text: input }] }],
          }),
          signal,
        },
      );
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
  if (!GEMINI_API_KEY || (LIMIT && !supabase)) return res.status(503).json({ error: '지금은 풀이를 볼 수 없습니다. 서버 설정을 확인하세요.' });
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

  const input = `오늘 날짜: ${today()}
사주 데이터:
${JSON.stringify(saju, null, 2)}
${req.body.question ? `\n사용자 질문: ${req.body.question}` : ''}`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const r = await requestGemini(input, topic, ac.signal);
    // SSE: "data: {...}" 줄마다 응답 조각이 온다
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const parts = JSON.parse(line.slice(6)).candidates?.[0]?.content?.parts || [];
        for (const p of parts) if (p.text && !p.thought) res.write(p.text);
      }
    }
    res.end();
  } catch (e) {
    if (LIMIT) await refundQuota(user.id).catch(() => {}); // 실패하거나 중간에 끊긴 요청은 횟수에서 빼준다
    if (ac.signal.aborted) return;
    console.error('Gemini 오류:', e.message);
    res.end(e.busy
      ? '\n\n지금 이용자가 많아 풀이를 작성하지 못했습니다. 잠시 후 다시 시도하세요.'
      : '\n\n풀이 작성 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.');
  }
});

app.listen(PORT, () => console.log(`사주 서버 실행: http://localhost:${PORT}`));
