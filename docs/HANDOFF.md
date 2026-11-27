# 진행 상황 / 이어서 할 일 (새 세션용)

## 완료
- 설계: docs/DESIGN.md, 키 발급: docs/API_KEYS.md
- backend: 점수 엔진, POST /recommend, Provider 어댑터
  - 실제 연동: Open-Meteo 날씨(키 불필요), Travelpayouts 해외 항공 캐시 왕복가(월 단위 조회 후 근접 날짜 선택)
  - TourAPI 행사(국내 4곳): KorService2 searchFestival2. 지역 필터는 areaCode 가 아니라 lDongRegnCd(제주50/부산26/강원51/전남12, 강릉·여수는 addr1 시 이름으로 추가 필터). 일정과 겹치는 행사만, 120일 초과 상설 제외, 상위 5건. 실패 시 Mock fallback, 연결 reset 대비 1회 재시도. 캐시: 지역별 '오늘(KST) 이후 행사' 원본 목록을 6시간 인메모리 캐시(여행 날짜가 달라도 공유, 겹침은 요청마다 로컬 필터), 동시 요청은 호출 공유, 갱신 실패 시 오래된 캐시 사용. 300건 초과로 잘리는 지역·과거 시작 여행은 캐시 없이 여행 시작일 기준 직접 조회. 12번 조회 기준 호출 13→4회(실측)
  - 기상청 단기예보(국내): getVilageFcst, 위경도→격자 변환(toGrid), 최근 발표 회차 자동 선택. 단기예보는 발표일~+3일만 커버 → 국내이면서 여행 전체가 3일 이내일 때만 사용, 그 외는 Open-Meteo→Mock 체인으로 위임. 4~10일은 아래 중기예보
  - 특일(공휴일) 혼잡 패널티: 특일정보 getRestDeInfo(월 단위 조회·24h 캐시, 대체공휴일 포함). 국내 목적지만, 여행 기간 내 공휴일 하루당 -3점(최대 -10점)을 총점에서 차감하고 Recommendation.penalties 로 사유 노출(가중치 factor 와 별개). 3/10 은 임의 튜닝값(scoring.ts 상수). API 실패 시 양력 고정 공휴일 Mock 으로 대체하고 국내 결과 dataNotes 에 안내\n  - Kakao 로컬 POI(국내): 카테고리 검색 AT4(관광명소)/FD6(음식점), 목적지 중심 반경 20km 의 meta.total_count 를 로그 스케일로 밀도(0..1)화(관광 6 : 음식점 4, 임의 튜닝값, kakao.ts). 상위 3곳 이름은 Recommendation.places 로 노출. 24h 캐시, 실패/해외는 샘플 poiDensity 로 fallback. 한계: 실측 밀도가 0.86~0.99 로 몰려 변별력 약함(샘플 0.6~0.85), 중심점 1개 기준이라 대도시·비섬 편향, 대표 장소는 '검색 상위'일 뿐 인기순 아님\n  - Open-Meteo 한도 주의: 무료 API 는 IP 당 일일 1만 회(응답 헤더 X-RateLimit-*). 이 클라우드 샌드박스는 공용 IP 라 한도가 소진돼 429 "Daily API request limit exceeded" 가 자주 남(스크린샷의 날씨가 mock 으로 나오는 이유). 대응: 동시 4개 제한, 429/5xx 백오프 재시도(Retry-After≤3초만 대기), Retry-After 가 길면 최대 30분간 호출 차단 후 바로 fallback, URL 별 캐시(평년값 24h/예보 3h)·중복 요청 공유. 평년값은 목적지×기간마다 3회 호출 → 한도가 문제되면 목적지당 3년치를 1회 받아 30일 캐시하는 방식으로 호출 수를 더 줄일 수 있음
  - 기상청 중기예보(국내, kmaMid.ts): getMidTa(기온, 도시코드) + getMidLandFcst(강수확률, 광역코드). 지역코드 제주 11G00201/11G00000, 부산 11H20201/11H20000, 강릉 11D20501/11D20000, 여수 21F20801/11F20000(전부 실호출로 확인). 발표 06/18시, 최신 회차만 데이터가 있고(전날 06시분은 NO_DATA) 18시 발표분은 5일 후부터 시작 → 최신 회차가 NO_DATA 면 직전 회차로, 여행 날짜 전부의 필드가 있을 때만 사용(발표일 기준 +4~+10일 밖이면 API 호출 없이 바로 fallback). 기온=일별 (최저+최고)/2 평균, 강수확률=일별 오전/오후 최댓값 평균. 체인: 단기(≤+3일) → 중기(+4~+10일) → Open-Meteo → Mock. 단기와 중기에 걸친 일정(예: +2~+6일)과 11일 이후는 Open-Meteo
  - 국내 숙소 요금(tourApiLodging.ts): TourAPI searchStay2(목록)+detailInfo2(객실요금) 의 공시 요금(비수기/성수기×주중/주말 객실 최저요금) 지역 중앙값. 상세 조회가 호출당 ~5초라 요청 경로에서 못 쓰고, 서버 시작 시 warmUp() 이 백그라운드로 지역당 균등표본 60곳을 수집 → 파일 캐시(.cache/lodging.json, LODGING_CACHE_FILE 로 변경, gitignore) → 7일마다 갱신(stale-while-revalidate). 수집 전·실패·요금 기재 숙소 부족(<5곳) 시 샘플값. 박마다 금·토=주말, 7~8월=성수기 휴리스틱. 한계: 실시간 가격 아님, 요금 기재 숙소만(약 1/4), '최저 요금' 기준이라 낮게 편향, estimated=true 로 표기. 숙소 평점은 여전히 샘플값
  - 해외 숙소 1박 요금·평점(serpApiHotels.ts): SerpAPI Google Hotels(engine=google_hotels, KRW, 성인 2). (목적지, 여행 시작 월) 단위로 검색 결과 상위 ~20곳(관련도순)의 호텔 유형 중앙값/평점 중앙값. 월 대표 표본 = 15일에 가장 가까운 목요일 체크인 2박. 무료 플랜 월 250회 → 월 호출 상한 SERPAPI_MONTHLY_BUDGET(기본 150, 사용량은 .cache/serpapi-hotels.json 에 기록·달 바뀌면 초기화), 캐시 30일, 실패 키 1시간 쿨다운, 응답 오류는 재시도 안 함(연결 오류만 1회). 서버 시작 시 해외 6곳 다음 달분 수집(6회), 첫 요청은 샘플값 후 백그라운드 수집. 한계: 실시간 가격·Agoda/Booking 사이트별 가격 아님(prices[] 는 거의 비어 있고 숙소별 추가 호출 필요), 표본 20곳·호텔 유형 위주, 샘플값 대비 차이 큼(도쿄 17→11만, 오사카 15→7.6만, 후쿠오카 12→14만). 국내 평점은 아직 샘플값(SerpAPI 로 보강 가능)
  - 해외 숙소 가격 대안 검토 결과: Hotellook 호스트 차단·서비스 상태 불명, Amadeus Self-Service 종료, Agoda-Demand 는 기업 파트너 계약 필요
  - Mock: 국내 숙소 평점, 국내선/국내 교통, 볼거리
- 상세 API: POST /destination/:id — /recommend 와 같은 요청 본문(가중치·태그가 같아야 목록 점수와 일치, scope 무시). 응답: destination, trip, withinBudget(예산 초과여도 상세는 반환), recommendation, cost(항공/숙소/현지 내역), weather, events, holidays, places, sources(항목별 출처·asOf·estimated), links. 없는 id 404. 평가 로직은 scoring.ts evaluateDestination 으로 /recommend 와 공유
- android: Compose 앱. 목록(RecommendScreen) + 상세(DetailScreen, POST /destination/{id}). 내비게이션 라이브러리 없이 UiState.detail 로 화면 전환 + BackHandler, 목록 스크롤 위치는 MainActivity 에서 LazyListState 보관. 상세는 검색 때 저장한 lastRequest 로 호출(입력창을 고쳐도 목록과 같은 점수), 늦게 온 응답은 destinationId 로 무시, 닫기 시 취소, 오류 시 재시도. 순수 로직은 ui/Format.kt(금액·KST 시각·출처 라벨). Models.kt 에 penalties/places/DestinationDetail 추가(구버전 응답 호환 기본값)
  - 검증 상태: Android SDK 가 없어 앱 전체 빌드·실기기 실행은 미검증. 대신 (1) 데이터 계층+ViewModel+Format 을 JVM 프로젝트로 컴파일하고 실제 백엔드와 Retrofit 로 통신하는 테스트 20개 통과, (2) Compose UI(DetailScreen/RecommendScreen)를 Compose Multiplatform 데스크톱으로 컴파일 통과(안드로이드 전용 API 3개는 shim). 화면 렌더링(스크린샷)은 Google Maven(dl.google.com) 이 이 환경에서 차단돼 못 함 → 실제 레이아웃은 에뮬레이터에서 확인 필요
  - Gradle 래퍼(8.10.2, AGP 8.7.3 요구 ≥8.9)를 android/ 에 추가함. 에뮬레이터 실행: Android Studio(Ladybug 2024.2.1+)에서 android/ 폴더를 열고, 백엔드는 PC 에서 `cd backend && npm run dev`(8080), 에뮬레이터는 10.0.2.2 로 접속(BuildConfig 에 설정됨)
  - 검증 하네스는 android/verify/ (README 참고): `./run.sh` = 로직 테스트(Mock 백엔드를 띄워 실제 통신) + UI 컴파일. 앱 소스를 복사 없이 그대로 컴파일하고 Android 전용 API 는 스텁/shim. 일부러 모델·UI 를 깨뜨려 실패하는 것까지 확인함. JUnit 주의: `fun t() = runBlocking { ... }` 가 값을 반환하면 JUnit 이 테스트를 조용히 건너뜀 → runBlocking<Unit> 사용
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
3. (완료: Kakao POI, 상세 API, 중기예보, android 상세 화면) 남은 일: 에뮬레이터/실기기에서 앱 실행·레이아웃 확인, 국내 숙소 평점 SerpAPI 보강
4. (완료: 숙소 가격 소스 검토, 국내 숙소 요금 Provider) 해외 숙소 가격은 파트너 계약 전까지 샘플. TourAPI 일일 호출 한도가 있을 수 있음(미확인): 행사는 캐시 추가로 /recommend 당 호출이 사실상 0~4회(6시간당 지역별 1~3회)로 감소
5. 각 Provider 는 실패 시 Mock fallback 유지, 단위 테스트(가짜 fetch) 추가
