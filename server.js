require('dotenv').config();
const express = require('express');
const { Solar, Lunar } = require('lunar-javascript');

const {
  PORT = 3000,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-flash-latest',
} = process.env;

if (!GEMINI_API_KEY) console.warn('API 키 미설정: 만세력만 사용할 수 있습니다.');

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
- 구성: ## 타고난 성향 / ## 오행 균형과 보완법 / ## 재물운 / ## 직업·적성 / ## 연애·관계 / ## 건강 / ## 대운 흐름 / ## 올해의 운세 (사용자 질문이 있으면 마지막에 ## 질문에 대한 답변 추가)
- 담백한 존댓말(~합니다)로 간결하게 쓰세요. 감성적 수사, 이모지, 과장된 위로·칭찬은 쓰지 마세요.
- 근거(오행·십신)를 짧게 밝히고 구체적으로 쓰되, 단정적인 공포 조장은 피하세요. 마크다운으로 작성하세요.
- 의료·법률·투자 판단은 전문가 상담을 권하세요.`;

app.post('/api/reading', async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(503).json({ error: 'AI 해석을 사용할 수 없습니다. 서버에 GEMINI_API_KEY가 설정되지 않았습니다.' });
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });

  let saju;
  try { saju = computeSaju(req.body); } catch { return res.status(400).json({ error: '존재하지 않는 날짜입니다' }); }

  const input = `오늘 날짜: ${today()}
사주 데이터:
${JSON.stringify(saju, null, 2)}
${req.body.question ? `\n사용자 질문: ${req.body.question}` : ''}`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
          contents: [{ role: 'user', parts: [{ text: input }] }],
        }),
        signal: ac.signal,
      },
    );
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
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
    if (ac.signal.aborted) return;
    console.error('Gemini 오류:', e.message);
    res.end('\n\n해석 생성 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.');
  }
});

app.listen(PORT, () => console.log(`사주 서버 실행: http://localhost:${PORT}`));
