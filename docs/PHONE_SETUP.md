# 안드로이드 폰에서 바로 실행하기 (PC 없이)

폰 한 대에서 앱(APK)과 서버를 같이 돌리는 방법. 서버는 Node 로 만든 백엔드를 **파일 하나**(`travel-backend.cjs`)로 묶어 Termux 에서 실행한다.
(`cd backend && npm run bundle` → `backend/dist/travel-backend.cjs`)

## 1. 앱 설치
`app-debug.apk` 를 열어 설치한다(출처를 알 수 없는 앱 허용, Play Protect 경고는 "그래도 설치").

## 2. 서버 실행 (Termux)
1. **F-Droid** 에서 Termux 를 설치한다(Play 스토어 버전은 오래돼 동작하지 않는다).
2. Termux 에서:
   ```
   pkg update -y && pkg install -y nodejs
   termux-setup-storage                       # 저장소 접근 허용
   cp ~/storage/downloads/travel-backend.cjs ~/    # 받은 파일 위치에 맞게
   termux-wake-lock                           # 백그라운드에서 꺼지지 않게
   node ~/travel-backend.cjs
   ```
   `listening on :8080` 이 보이면 성공. Termux 는 닫지 말고 앱으로 전환한다(알림창에 Termux 가 남아 있어야 함).
3. (선택) 실제 데이터를 쓰려면 서버 실행 **전에** 키를 환경 변수로 넣는다. 없으면 샘플 데이터로 동작한다.
   ```
   export DATA_GO_KR_SERVICE_KEY=...   # 관광공사 행사, 기상청, 특일
   export KAKAO_REST_API_KEY=...       # 볼거리·식당
   export SERPAPI_KEY=...              # 해외 숙소 가격·평점(월 250회 무료)
   export TRAVELPAYOUTS_TOKEN=...      # 해외 항공
   ```
   키 값은 채팅·저장소에 붙여넣지 않는다. 키 발급은 `docs/API_KEYS.md`.

## 3. 앱에서 서버 연결
앱 → 목록 화면의 **서버 설정** → `http://127.0.0.1:8080/` 입력 → 저장 → 추천 받기.
(첫 요청은 서버 캐시가 비어 10초 안팎 걸릴 수 있다.)

## 문제 해결
- "요청 실패: Failed to connect" → Termux 의 서버가 꺼졌다. Termux 를 열어 다시 실행(`termux-wake-lock` 확인, 배터리 최적화에서 Termux 제외).
- 포트가 사용 중이면 `PORT=8081 node ~/travel-backend.cjs` 후 앱 주소도 8081 로.
- 같은 Wi-Fi 의 다른 기기에서 쓰려면 `http://<폰 IP>:8080/`.
