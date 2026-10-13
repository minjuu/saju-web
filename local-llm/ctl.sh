#!/bin/zsh
# 맥에서 돌아가는 사주토끼 AI(Ollama + 연결기) 켜기/끄기/상태 확인
# 사용법: ./ctl.sh on | off | status | log
LA=~/Library/LaunchAgents
LOG=~/Library/Logs/saju-localllm.log
U=gui/$(id -u)
case "$1" in
  on)
    for s in com.sajutokki.ollama com.sajutokki.localllm; do
      launchctl enable $U/$s; launchctl bootstrap $U $LA/$s.plist 2>/dev/null
    done
    echo "켰어요. 1분 안에 사이트와 연결돼요." ;;
  off)
    for s in com.sajutokki.localllm com.sajutokki.ollama; do
      launchctl bootout $U/$s 2>/dev/null; launchctl disable $U/$s
    done
    echo "껐어요. 재부팅해도 꺼진 상태로 있어요. 사이트 풀이는 Gemini(무료 한도 내)로 넘어가요." ;;
  status)
    if launchctl print $U/com.sajutokki.localllm >/dev/null 2>&1; then echo "연결기: 켜짐"; else echo "연결기: 꺼짐"; fi
    if curl -s -m 2 localhost:11434/api/version >/dev/null; then echo "Ollama: 켜짐"; else echo "Ollama: 꺼짐"; fi
    grep -E "사이트에 연결됨|사이트 연결 실패" $LOG 2>/dev/null | tail -1 | sed 's/^/마지막 연결 상태: /'
    python3 - "$HOME/Library/Logs/saju-requests.jsonl" <<'PY'
import json, sys, collections, datetime
try:
    rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
except FileNotFoundError:
    rows = []
today = datetime.date.today()
def local(r): return datetime.datetime.fromisoformat(r['ts'].replace('Z', '+00:00')).astimezone()
real = [r for r in rows if local(r).date() == today and not r.get('test')]
tests = sum(1 for r in rows if local(r).date() == today and r.get('test'))
print(f"\n오늘 풀이: {len(real)}건 · 방문자 {len({r.get('visitor') for r in real})}명" + (f" (테스트 {tests}건 제외)" if tests else ""))
for k, n in collections.Counter(r.get('kind', '?') for r in real).most_common():
    print(f"  {k}: {n}건")
if real:
    print(f"  평균 {round(sum(r.get('sec', 0) for r in real) / len(real))}초")
    print("\n최근 요청")
    for r in real[-5:]:
        print(f"  {local(r):%H:%M}  {r.get('kind','')}  {r.get('device','')}  방문자 #{r.get('visitor','-')}  {r.get('sec')}초")
PY
    ;;
  log)
    echo "실시간 로그 (끄려면 Ctrl+C)"; tail -f $LOG ;;
  *) echo "사용법: $0 on | off | status | log" ;;
esac
