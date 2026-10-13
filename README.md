# AI 사주풀이

만세력 계산(lunar-javascript) + ChatGPT(OpenAI API) 해석 웹사이트.

## 실행
1. `cp .env.example .env` 후 `OPENAI_API_KEY` 입력
2. `npm install`
3. `npm run dev` → http://localhost:3000

사주 팔자·십신·대운은 서버에서 정확히 계산하고, ChatGPT에는 해석만 맡깁니다.

## Render 무료 서버 배포

`render.yaml`에 무료 Web Service 설정을 준비했습니다. 아직 실제 서버는 생성하지 않았습니다.

1. 이 프로젝트를 본인의 GitHub 저장소에 업로드합니다. `.env`와 `node_modules`는 제외합니다.
2. Render에 로그인하고 New → Blueprint에서 저장소를 연결합니다.
3. `OPENAI_API_KEY`에 직접 발급한 키를 입력하고 배포합니다.
4. 발급된 `onrender.com` 주소에서 확인합니다.

무료 서버는 15분 동안 요청이 없으면 휴면 상태가 되어 다음 접속이 느릴 수 있습니다.
서버 무료 요금과 OpenAI API 사용료는 별개입니다. 현재 풀이 요청에 인증이나 사용량 제한이 없으므로 공개 주소 이용자의 요청도 운영자 키로 청구됩니다.
키 발급: https://platform.openai.com/api-keys
