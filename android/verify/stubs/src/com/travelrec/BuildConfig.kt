// 검증용 스텁: Android 가 생성하는 BuildConfig 대신 시스템 프로퍼티(api.base/api.token)를 읽는다.
package com.travelrec
object BuildConfig {
    val API_BASE_URL: String = System.getProperty("api.base") ?: "http://localhost:18083/"
    val API_TOKEN: String = System.getProperty("api.token") ?: "dev-token"
}
