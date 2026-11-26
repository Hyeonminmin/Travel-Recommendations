# 진행 상황 / 이어서 할 일 (새 세션용)

## 완료
- 설계: docs/DESIGN.md, 키 발급: docs/API_KEYS.md
- backend: 점수 엔진, POST /recommend, Provider 어댑터
  - 실제 연동: Open-Meteo 날씨(키 불필요), Travelpayouts 해외 항공 캐시 왕복가(월 단위 조회 후 근접 날짜 선택)
  - TourAPI 행사(국내 4곳): KorService2 searchFestival2. 지역 필터는 areaCode 가 아니라 lDongRegnCd(제주50/부산26/강원51/전남12, 강릉·여수는 addr1 시 이름으로 추가 필터). 일정과 겹치는 행사만, 120일 초과 상설 제외, 상위 5건. 실패 시 Mock fallback, 연결 reset 대비 1회 재시도
  - 기상청 단기예보(국내): getVilageFcst, 위경도→격자 변환(toGrid), 최근 발표 회차 자동 선택. 단기예보는 발표일~+3일만 커버 → 국내이면서 여행 전체가 3일 이내일 때만 사용, 그 외는 Open-Meteo→Mock 체인으로 위임. 4~10일 구간은 중기예보(별도 API) 미구현이라 Open-Meteo 사용
  - 특일(공휴일) 혼잡 패널티: 특일정보 getRestDeInfo(월 단위 조회·24h 캐시, 대체공휴일 포함). 국내 목적지만, 여행 기간 내 공휴일 하루당 -3점(최대 -10점)을 총점에서 차감하고 Recommendation.penalties 로 사유 노출(가중치 factor 와 별개). 3/10 은 임의 튜닝값(scoring.ts 상수). API 실패 시 양력 고정 공휴일 Mock 으로 대체하고 국내 결과 dataNotes 에 안내\n  - Kakao 로컬 POI(국내): 카테고리 검색 AT4(관광명소)/FD6(음식점), 목적지 중심 반경 20km 의 meta.total_count 를 로그 스케일로 밀도(0..1)화(관광 6 : 음식점 4, 임의 튜닝값, kakao.ts). 상위 3곳 이름은 Recommendation.places 로 노출. 24h 캐시, 실패/해외는 샘플 poiDensity 로 fallback. 한계: 실측 밀도가 0.86~0.99 로 몰려 변별력 약함(샘플 0.6~0.85), 중심점 1개 기준이라 대도시·비섬 편향, 대표 장소는 '검색 상위'일 뿐 인기순 아님\n  - Mock: 숙소, 국내선/국내 교통, 볼거리
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
   - (완료) verify:apis 6/6 OK, TourAPI=KorService2
2. (완료: TourAPI 행사, 기상청 단기예보, 특일 패널티)
3. (완료: Kakao POI) 결과 상세 API(/destination/{id}); 중기예보(4~10일) 추가 검토
4. 숙소 가격 소스 검토(Travelpayouts Hotellook 가능 여부)
5. 각 Provider 는 실패 시 Mock fallback 유지, 단위 테스트(가짜 fetch) 추가
