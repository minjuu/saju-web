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
    echo "누적 풀이 수: $(grep -c '풀이 완료' $LOG 2>/dev/null)" ;;
  log)
    echo "실시간 로그 (끄려면 Ctrl+C)"; tail -f $LOG ;;
  *) echo "사용법: $0 on | off | status | log" ;;
esac
