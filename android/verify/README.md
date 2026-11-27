# Android 검증 하네스 (SDK 불필요)

Android SDK 없이 앱 코드를 검증하는 Gradle 프로젝트. 앱 소스(`../app/src/main/java`)를 복사하지 않고 그대로 컴파일한다.

| 프로젝트 | 하는 일 |
|---|---|
| `logic` | 데이터 계층(`Models`/`Api`)·`RecommendViewModel`·`Format` 을 JVM 으로 컴파일하고, **실제 백엔드(Mock 모드)와 Retrofit 으로 통신**하는 테스트 실행 |
| `ui` | `DetailScreen`/`RecommendScreen` 을 Compose Multiplatform(데스크톱)으로 컴파일 검증하고, `render` 로 **PNG 이미지로 렌더링**(레이아웃 육안 확인용) |

```
./run.sh          # logic 테스트 + ui 컴파일
./run.sh logic
./run.sh ui
./run.sh render   # 화면 PNG 생성 → ui/build/renders (Google Maven 접근 필요, Mock 데이터)
```

## 한계 (검증하지 않는 것)
- 앱 전체 빌드(AGP/SDK)와 실기기·에뮬레이터 실행은 검증하지 않는다. `render` 의 이미지는 데스크톱 Compose(Skia)가 그린 것이라 폰트·상태바 여백·시스템 UI 가 실제 안드로이드와 다르고, 터치 동작은 확인할 수 없다. 최종 확인은 에뮬레이터/실기기에서 한다.
- `ui` 는 데스크톱 Compose(Material3 1.3.0)로 컴파일하므로 앱의 BOM 버전과 API 차이가 있으면 놓칠 수 있다.
- Android 전용 API 는 shim/스텁으로 대체한다: `BuildConfig`, `ViewModel`/`viewModelScope`(`stubs/`), `statusBarsPadding`, `collectAsStateWithLifecycle`, `BackHandler`(`ui/src/main/kotlin/`). 실제 동작이 shim 과 다를 수 있다(예: 실제 `viewModelScope` 는 Main 디스패처).

## 주의
- 테스트를 `fun t() = runBlocking { ... }` 로 쓰면 마지막 식의 값이 반환되어 JUnit 이 **조용히 건너뛴다**. 반드시 `runBlocking<Unit>` 을 쓴다.
- Maven Central 이 일시적으로 429 를 줄 수 있다(재시도하면 캐시된 파일은 이어서 받는다).
