# 진행 상황 / 이어서 할 일 (새 세션용)

## 완료
- 설계: docs/DESIGN.md, 키 발급: docs/API_KEYS.md
- backend: 점수 엔진, POST /recommend, Provider 어댑터
  - 실제 연동: Open-Meteo 날씨(키 불필요), Travelpayouts 해외 항공 캐시 왕복가(월 단위 조회 후 근접 날짜 선택)
  - Mock: 숙소, 행사, 국내선/국내 교통, 볼거리
- android: Compose 스캐폴딩(빌드 미검증, SDK 없음)
- Travelpayouts 토큰은 환경의 Network secret(헤더 X-Access-Token)으로 저장됨. 프록시가 주입하므로
  코드에서는 TRAVELPAYOUTS_TOKEN=proxy-injected 로 실행. 이 환경에서 Node fetch 로 호출하려면
  `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` 필요.

## 사용자가 환경 변수로 추가하기로 한 키 (이 세션에서 읽을 변수명)
- DATA_GO_KR_SERVICE_KEY  (data.go.kr 일반 인증키; 관광공사 국문관광정보, 기상청 단기예보, 특일정보 활용신청 필요)
- KAKAO_REST_API_KEY      (Kakao REST API 키; 카카오맵 사용 설정 ON)
키 값은 채팅에 붙여넣지 않는다. 값을 출력/로그/커밋하지 않는다.

## 이번 세션 결과
- 사용자가 환경 Allowed domains 에 4개 호스트 추가 완료 → 실호출 가능. verify:apis: Travelpayouts/TourAPI/기상청/Kakao OK, 특일은 curl 로 정상(Node 1회 fetch failed, 일시적),
  Open-Meteo 는 공용 IP 일일한도 429(우리 코드 문제 아님, 시간이 지나면 해소).
- TourAPI 행사 Provider 실응답으로 확정(src/providers/tourApi.ts):
  KorService2 는 `areacode` 가 비어 있고 `lDongRegnCd`(법정동 시도코드: 제주50 부산26 강원51 전남46)로 필터. 서버가 간헐적으로 연결을 끊어 3회 재시도.
  행사 기간 겹침 + addr1 에 도시명 포함으로 필터. 상세 API GET /destination/:id 완료.
- 특일 응답: `response.body.items.item` 이 1건이면 객체, 여러 건이면 배열, `locdate`(숫자 YYYYMMDD), `isHoliday`("Y"), `dateName`.

- 특일 Provider(holidays.ts, 실응답 확인): 기간 내 공휴일 1일당 logistics 점수 -0.1(최대 -0.3). 설날 연휴·대체공휴일 정상 수신.
- Kakao 장소 Provider(kakaoPlaces.ts, 실응답 확인): 국내 음식점(FD6)/관광명소(AT4) 정확도순. 상세 API(/destination/:id)의 places 로 노출. 점수에는 미반영(poiDensity 샘플값 그대로).

- 기상청 단기예보 Provider(kma.ts, 실응답 확인): 위경도→격자 변환(서울 60,127 검증), 발표 시각 계산(KST, 10분 지연). 발표 시점 기준 약 5일치만 제공 →
  여행 일수의 절반 이상을 덮을 때만 사용, 아니면 fallback(Open-Meteo 평년값 → Mock). 중기예보(4~10일)는 지역코드 체계가 달라 미구현.

## 다음 작업 (1번은 완료: 단, 네트워크 허용 후 재실행 필요)
1. `cd backend && npm install && npm run verify:apis` 를 NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt 와 함께 실행해 OK/FAIL 확인
   - TourAPI 서비스 버전(KorService2/1)과 필드 구조는 실제 응답으로 확정할 것
2. (TourAPI 행사/특일/기상청 단기예보 완료) 기상청 중기예보(국내 4~10일) 필요 시 추가
3. (Kakao 장소·상세 API 완료) poiDensity 를 Kakao 결과 수 등 실데이터로 대체할지 검토, Android 상세 화면 연동
4. 숙소 가격 소스 검토(Travelpayouts Hotellook 가능 여부)
5. 각 Provider 는 실패 시 Mock fallback 유지, 단위 테스트(가짜 fetch) 추가
