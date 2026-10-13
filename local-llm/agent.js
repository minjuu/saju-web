// 맥에서 돌리는 로컬 LLM 연결기
// 1) 비밀 키를 확인하는 프록시로 Ollama(127.0.0.1:11434)를 감싼다
// 2) Cloudflare 임시 터널로 프록시를 인터넷에 연다
// 3) 터널 주소를 사이트(Render)에 20초마다 등록한다 — 주소가 바뀌거나 서버가 재시작돼도 다시 연결된다
const http = require('http');
const fs = require('fs');
const path = require('path');

// 설정 파일: AGENT_ENV_FILE 또는 저장소의 .env (KEY=VALUE 형식). 백그라운드 실행 시 macOS가 Documents 접근을
// 막기 때문에, 상시 실행용으로는 이 파일과 설정을 ~/Library/Application Support/saju-localllm 에 복사해 쓴다
const envFile = process.env.AGENT_ENV_FILE || path.join(__dirname, '..', '.env');
try {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}
const { spawn } = require('child_process');
const groups = {};
const STATS_FILE = path.join(require('os').homedir(), 'Library/Logs/saju-requests.jsonl');

const {
  LOCAL_LLM_SECRET,
  SITE_URL = 'https://saju-tokki.onrender.com',
  PROXY_PORT = '11435',
  OLLAMA_URL = 'http://127.0.0.1:11434',
  LOCAL_LLM_MODEL = 'gpt-oss:20b',
} = process.env;
if (!LOCAL_LLM_SECRET) { console.error('.env에 LOCAL_LLM_SECRET이 없습니다'); process.exit(1); }

const proxy = http.createServer((req, res) => {
  if (req.headers['x-llm-secret'] !== LOCAL_LLM_SECRET || req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(403).end();
    return;
  }
  const t0 = Date.now();
  let meta = {};
  try { meta = JSON.parse(decodeURIComponent(req.headers['x-llm-meta'] || '%7B%7D')); } catch {}
  const who = `${meta.kind || '풀이'}  ${meta.device || ''}  방문자 #${meta.visitor || '-'}${meta.test ? '  (테스트)' : ''}`;
  // 사주는 섹션별로 여러 요청이 오므로(rid가 같음) 첫 요청과 마지막 완료만 한 줄씩 남긴다
  const group = meta.rid ? (groups[meta.rid] ||= { t0, left: meta.parts || 1, ok: true }) : { t0, left: 1, ok: true };
  if (!meta.rid || meta.part === 0) console.log(new Date().toLocaleTimeString('ko-KR'), '요청', who);
  res.on('finish', () => {
    if (res.statusCode >= 400) group.ok = false;
    if (--group.left > 0) return;
    if (meta.rid) delete groups[meta.rid];
    const sec = Math.round((Date.now() - group.t0) / 1000);
    console.log(new Date().toLocaleTimeString('ko-KR'), group.ok ? '완료' : '실패', who, `${sec}초`);
    // 통계용 기록 (ctl.sh status가 읽는다) — 풀이 하나당 한 줄
    const { rid, part, parts, ...rest } = meta;
    fs.appendFile(STATS_FILE, JSON.stringify({ ts: new Date().toISOString(), ...rest, sec, ok: group.ok }) + '\n', () => {});
  });
  const up = http.request(`${OLLAMA_URL}${req.url}`, { method: 'POST', headers: { 'content-type': 'application/json' } }, upRes => {
    res.writeHead(upRes.statusCode, { 'content-type': upRes.headers['content-type'] || 'text/event-stream' });
    upRes.pipe(res);
  });
  up.on('error', () => res.headersSent ? res.end() : res.writeHead(502).end());
  res.on('close', () => up.destroy());
  req.pipe(up);
});
proxy.listen(Number(PROXY_PORT), '127.0.0.1', () => console.log(`프록시: 127.0.0.1:${PROXY_PORT} → ${OLLAMA_URL}`));

let tunnelUrl = null;
const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${PROXY_PORT}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
const onLog = buf => {
  const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && m[0] !== tunnelUrl) {
    tunnelUrl = m[0];
    console.log('터널 주소:', tunnelUrl);
    setTimeout(register, 3000); // 터널이 준비될 시간을 조금 준다
  }
};
tunnel.stdout.on('data', onLog);
tunnel.stderr.on('data', onLog);
tunnel.on('exit', code => { console.error('cloudflared 종료:', code); process.exit(1); });

let lastStatus = null;
async function register() {
  if (!tunnelUrl) return;
  try {
    const r = await fetch(`${SITE_URL}/api/llm/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-llm-secret': LOCAL_LLM_SECRET },
      body: JSON.stringify({ url: tunnelUrl }),
      signal: AbortSignal.timeout(90000), // Render 무료 서버가 잠들어 있으면 깨어나는 데 시간이 걸린다
    });
    if (r.status !== lastStatus) console.log(new Date().toLocaleTimeString('ko-KR'), r.ok ? '사이트에 연결됨' : `사이트 연결 실패 (${r.status})`);
    lastStatus = r.status;
  } catch (e) {
    console.warn('등록 실패:', e.message);
  }
}
setInterval(register, 20000); // 서버가 재배포되면 등록 정보가 사라지므로 자주 알린다

// Ollama는 5분간 안 쓰면 모델을 메모리에서 내린다. 다시 올리는 데 시간이 걸려 첫 풀이가 늦어지므로 계속 올려 둔다
async function keepWarm() {
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: LOCAL_LLM_MODEL, keep_alive: -1 }),
    });
  } catch (e) {
    console.warn('모델 예열 실패:', e.message);
  }
}
keepWarm();
setInterval(keepWarm, 10 * 60000);

const stop = () => { tunnel.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
