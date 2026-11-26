plugins {
    kotlin("jvm") version "2.0.21"
    kotlin("plugin.serialization") version "2.0.21"
}
repositories { mavenCentral() }

// 앱(app/src/main/java)의 소스를 복사 없이 그대로 컴파일한다. Compose 화면과 Activity 는 제외(순수 로직만).
kotlin {
    jvmToolchain(21)
    sourceSets.main {
        kotlin.srcDir("../../app/src/main/java")
        kotlin.srcDir("../stubs/src")
        kotlin.exclude("**/ui/*Screen.kt", "**/MainActivity.kt")
    }
}
dependencies {
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    testImplementation(kotlin("test"))
}
tasks.test {
    useJUnitPlatform()
    // 테스트는 실제 백엔드에 붙는다(run.sh 가 Mock 모드로 띄워 준다). 주소·토큰은 -D 로 전달.
    systemProperty("api.base", System.getProperty("api.base") ?: "http://localhost:18083/")
    systemProperty("api.token", System.getProperty("api.token") ?: "dev-token")
    testLogging { events("passed", "failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
