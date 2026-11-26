// 한 번에 두 프로젝트를 다루기 위한 루트. 각각 `gradle -p verify/logic ...` 처럼도 실행할 수 있다.
rootProject.name = "android-verify"
include("logic", "ui")
pluginManagement { repositories { gradlePluginPortal(); mavenCentral() } }
