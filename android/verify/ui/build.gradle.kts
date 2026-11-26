plugins {
    kotlin("jvm") version "2.0.21"
    kotlin("plugin.serialization") version "2.0.21"
    kotlin("plugin.compose") version "2.0.21"
    id("org.jetbrains.compose") version "1.7.3"
}
repositories { mavenCentral() }

// Compose UI 컴파일 검증 전용(실행·렌더링은 하지 않는다). 데스크톱 Compose 는 androidx.compose.* 와 같은 패키지를 제공한다.
// 같은 소스를 쓰되 Android 전용 MainActivity 만 제외하고, Android 전용 API 3개는 src/main/kotlin 의 shim 으로 대체.
kotlin {
    jvmToolchain(21)
    sourceSets.main {
        kotlin.srcDir("../../app/src/main/java")
        kotlin.srcDir("../stubs/src")
        kotlin.exclude("**/MainActivity.kt")
    }
}
dependencies {
    implementation(compose.desktop.currentOs)
    implementation(compose.material3)
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
}
