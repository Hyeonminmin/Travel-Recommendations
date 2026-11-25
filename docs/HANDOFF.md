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

## 다음 작업
1. `cd backend && npm install && npm run verify:apis` 를 NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt 와 함께 실행해 OK/FAIL 확인
   - TourAPI 서비스 버전(KorService2/1)과 필드 구조는 실제 응답으로 확정할 것
2. TourAPI 행사 Provider(EventProvider), 기상청 단기예보(국내 15일 이내), 특일(공휴일 혼잡 패널티) 구현
3. Kakao 로컬 기반 식당/볼거리 Provider 추가, 결과 상세 API(/destination/{id})
4. 숙소 가격 소스 검토(Travelpayouts Hotellook 가능 여부)
5. 각 Provider 는 실패 시 Mock fallback 유지, 단위 테스트(가짜 fetch) 추가
