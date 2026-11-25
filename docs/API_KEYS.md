# API 키 발급 가이드 (Phase 0)

> 화면 메뉴 이름은 사이트 개편으로 달라질 수 있습니다. 막히면 사이트의 "API/개발자/이용안내" 메뉴를 찾으세요.
> **키는 채팅/이슈/커밋에 붙여넣지 마세요.** 본인 PC의 `backend/.env` 에만 넣습니다. (`.env` 는 `.gitignore` 처리됨)

## 우선순위 요약
| 순서 | API | 용도 | 필수? | 난이도 |
|---|---|---|---|---|
| 1 | Travelpayouts | 해외 항공 캐시 최저가 | 필수 | 중 |
| 2 | 공공데이터포털(data.go.kr) 3종 | 국내 행사/관광지, 날씨, 공휴일 | 필수 | 하 |
| 3 | Kakao Developers | 국내 식당/장소 검색 | 필수 | 하 |
| 4 | Open-Meteo | 해외 날씨 | **키 불필요** | - |
| 5 | Naver 검색 API | 국내 장소 보강 | 선택 | 하 |
| 6 | Anthropic API | 리뷰/추천사유 요약 (Phase 2) | 나중에 | 하 |

> ⚠️ **Amadeus Self-Service는 2026-07-17에 종료**되어(신규 가입 중단, 키 비활성화) 후보에서 제외했습니다. 해외 항공/호텔 가격은 Travelpayouts 캐시 데이터에 의존하며, 이 데이터는 "최근 검색된 가격"이라 실시간 가격이 아닙니다. (출처: [PhocusWire](https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers), [Amadeus 공지](https://amadeus.com/en/industry-messaging/statement-regarding-amadeus-for-developers-portal))

---

## 1. Travelpayouts (항공 캐시가)
1. https://www.travelpayouts.com 접속 → **Sign up**(이메일 가입, 무료).
2. 가입 시 "웹사이트/프로젝트" 정보를 물으면 사실대로 입력합니다. (개인 프로젝트라면 GitHub 저장소 주소 등)
3. 로그인 후 **Developers → API**(또는 https://www.travelpayouts.com/developers/api ) 로 이동.
4. **API token** 복사 → `.env` 의 `TRAVELPAYOUTS_TOKEN`.
5. 프로필의 **Marker(파트너 ID)** 는 `TRAVELPAYOUTS_MARKER` (현재 단계에선 비워도 됨. 우리는 제휴 수익/순위 연동을 하지 않음).
6. 호출 방식: 헤더 `X-Access-Token: <token>` 또는 `token` 쿼리 파라미터. ([공식 안내](https://support.travelpayouts.com/hc/en-us/articles/203956163))
- 확인 포인트: 일부 기능은 계정 승인/요건이 있을 수 있음 → [Requirements for Aviasales data API access](https://support.travelpayouts.com/hc/en-us/articles/203956083-Requirements-for-Aviasales-data-API-access) 참고.
- 한계: 캐시 데이터라 노선/날짜에 따라 결과가 비어 있을 수 있음.

## 2. 공공데이터포털 (data.go.kr) — 한 번 가입, 키 하나로 3개 서비스
키는 **계정당 1개(일반 인증키)** 이며 서비스마다 "활용신청"만 따로 합니다.
1. https://www.data.go.kr 회원가입/로그인 (이메일 또는 간편인증).
2. 상단 검색창에 아래 이름을 검색 → 해당 API 상세 → **활용신청** → 활용 목적(예: "개인 앱 개발") 입력 → 신청 (개발계정은 대개 자동 승인).
   - `한국관광공사_국문 관광정보 서비스_GW` (행사·관광지·음식점·숙박)
   - `기상청_단기예보 ((구)_동네예보) 조회서비스` (필요 시 `중기예보 조회서비스`도)
   - `한국천문연구원_특일 정보` (공휴일)
3. **마이페이지 → 데이터활용 → Open API → 활용신청 현황** 에서 각 서비스 클릭 → **일반 인증키(Encoding / Decoding)** 두 값이 보입니다.
4. 둘 중 하나를 `.env` 의 `DATA_GO_KR_SERVICE_KEY` 에 입력 (검증 스크립트가 이미 인코딩된 키면 자동으로 풀어서 사용).
- 승인 직후엔 키가 반영되기까지 **수 분~1시간** 걸려 `Unauthorized/Forbidden`이 날 수 있음.
- 개발계정은 **일일 호출 한도**가 있으므로 서버 캐시 필수 (한도는 상세 페이지에서 확인).
- 참고: [TourAPI 사용 안내 예시](https://velog.io/@gktmzl12/Tour-API-사용하기), 관광공사 포털 https://api.visitkorea.or.kr

## 3. Kakao Developers (로컬 검색)
1. https://developers.kakao.com → 카카오 계정 로그인 → 개발자 등록.
2. **내 애플리케이션 → 애플리케이션 추가** (앱 이름: 예 `TravelRec`).
3. 앱 선택 → **앱 키** 탭에서 **REST API 키** 복사 → `.env` 의 `KAKAO_REST_API_KEY`.
4. **카카오맵(로컬) 사용 설정**이 꺼져 있으면 호출이 거부됨 → 앱 설정의 제품/서비스 메뉴에서 **카카오맵 활성화(ON)**.
- 호출 방식: 헤더 `Authorization: KakaoAK <REST API 키>`.

## 4. Open-Meteo (해외 날씨)
- 키/가입 없음. 비상업적 개인 사용 무료. https://open-meteo.com

## 5. (선택) Naver 검색 API
1. https://developers.naver.com → 로그인 → **Application → 애플리케이션 등록**.
2. 사용 API에서 **검색** 선택, 환경은 "WEB 설정"에 `http://localhost` 입력.
3. 발급된 **Client ID / Client Secret** 보관. (필요해지면 `.env` 항목 추가)

## 6. (나중에) Anthropic API
- https://console.anthropic.com → API Keys 에서 발급. Phase 2 (리뷰 요약) 때 서버 환경변수로만 사용.

---

## 키 입력 후 검증하는 방법 (본인 PC)
```bash
cd backend
cp .env.example .env       # 키 입력
npm install
npm run verify:apis        # OK / FAIL / SKIP 결과만 출력 (키는 출력 안 함)
```
- 결과 표(OK/FAIL 한 줄씩, 키 제외)만 채팅에 붙여 주시면 소스 확정 → Provider 구현으로 넘어갑니다.
- 키가 없는 API는 `SKIP` 으로 나오며 서버는 해당 부분을 Mock 데이터로 계속 동작합니다.
