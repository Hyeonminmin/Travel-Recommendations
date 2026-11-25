# Travel-Recommendations

광고/제휴 편향 없는 개인용 여행지 추천 앱. 조건(날짜·예산·취향)에서 목적지를 도출하고 근거를 보여준다.

- 설계: [docs/DESIGN.md](docs/DESIGN.md)
- API 키 발급: [docs/API_KEYS.md](docs/API_KEYS.md)
- `backend/` — TypeScript(Fastify) 서버. 점수 엔진 + Provider 어댑터(현재 Mock)
- `android/` — Kotlin + Jetpack Compose 앱

## 실행
```bash
# 백엔드
cd backend && npm install && npm test && npm run dev     # http://localhost:8080
# Android: android/ 를 Android Studio 로 열어 실행 (에뮬레이터는 10.0.2.2:8080 으로 접속)
```
> `android/` 는 이 저장소 작성 환경에 Android SDK가 없어 **아직 빌드 검증을 하지 못했습니다.** Android Studio에서 처음 열 때 Gradle Wrapper 생성/Sync 중 오류가 나면 알려 주세요.
