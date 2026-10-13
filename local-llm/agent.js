// 맥에서 돌리는 로컬 LLM 연결기
// 1) 비밀 키를 확인하는 프록시로 Ollama(127.0.0.1:11434)를 감싼다
// 2) Cloudflare 임시 터널로 프록시를 인터넷에 연다
// 3) 터널 주소를 사이트(Render)에 1분마다 등록한다 — 주소가 바뀌거나 서버가 재시작돼도 다시 연결된다
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const { spawn } = require('child_process');

const {
  LOCAL_LLM_SECRET,
  SITE_URL = 'https://saju-tokki.onrender.com',
  PROXY_PORT = '11435',
  OLLAMA_URL = 'http://127.0.0.1:11434',
} = process.env;
if (!LOCAL_LLM_SECRET) { console.error('.env에 LOCAL_LLM_SECRET이 없습니다'); process.exit(1); }

const proxy = http.createServer((req, res) => {
  if (req.headers['x-llm-secret'] !== LOCAL_LLM_SECRET || req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(403).end();
    return;
  }
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

async function register() {
  if (!tunnelUrl) return;
  try {
    const r = await fetch(`${SITE_URL}/api/llm/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-llm-secret': LOCAL_LLM_SECRET },
      body: JSON.stringify({ url: tunnelUrl }),
      signal: AbortSignal.timeout(90000), // Render 무료 서버가 잠들어 있으면 깨어나는 데 시간이 걸린다
    });
    console.log(new Date().toLocaleTimeString('ko-KR'), '등록', r.status);
  } catch (e) {
    console.warn('등록 실패:', e.message);
  }
}
setInterval(register, 60000);

const stop = () => { tunnel.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
