package com.travelrec.data

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.travelrec.BuildConfig
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import java.util.concurrent.TimeUnit
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.POST
import retrofit2.http.Path

interface TravelApi {
    @POST("recommend")
    suspend fun recommend(@Body request: RecommendRequest): RecommendResponse

    /** 목록과 같은 요청 본문을 보내야 점수·가중치가 목록과 일치한다. */
    @POST("destination/{id}")
    suspend fun destination(@Path("id") id: String, @Body request: RecommendRequest): DestinationDetail
}

/**
 * 서버 주소 입력값을 검증·정규화한다. http/https 만 허용하고 끝에 '/' 를 붙인다. 올바르지 않으면 null.
 * 순수 함수라 JVM 에서 테스트할 수 있다.
 */
fun normalizeBaseUrl(raw: String): String? {
    val url = raw.trim().toHttpUrlOrNull() ?: return null
    if (url.scheme != "http" && url.scheme != "https") return null
    if (url.query != null || url.fragment != null) return null
    return url.newBuilder().encodedPath(url.encodedPath.trimEnd('/') + "/").build().toString()
}

/** 수동 DI. 규모가 커지면 Hilt 로 전환. 앱에는 외부 API 키 대신 자체 서버 토큰만 둔다. */
object ApiProvider {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /** 앱 안에서 바꿀 수 있는 서버 주소(기본값은 BuildConfig). 요청마다 이 값으로 목적지를 바꿔 치기해서 재빌드 없이 서버를 바꾼다. */
    @Volatile private var baseUrl: HttpUrl = BuildConfig.API_BASE_URL.toHttpUrl()

    val currentBaseUrl: String get() = baseUrl.toString()

    /** 정규화에 성공하면 적용하고 정규화된 주소를, 실패하면 null 을 돌려준다. */
    fun setBaseUrl(raw: String): String? {
        val normalized = normalizeBaseUrl(raw) ?: return null
        baseUrl = normalized.toHttpUrl()
        return normalized
    }

    val api: TravelApi by lazy {
        val client = OkHttpClient.Builder()
            // 서버 캐시가 비어 있는 첫 요청은 외부 API 를 여러 개 부르느라 10초(OkHttp 기본)를 넘길 수 있다
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(Interceptor { chain ->
                // Retrofit 은 BuildConfig 주소로 요청을 만들고, 여기서 현재 서버 주소(스킴·호스트·포트·경로 접두사)로 바꾼다
                val base = baseUrl
                val orig = chain.request().url
                val target = orig.newBuilder()
                    .scheme(base.scheme).host(base.host).port(base.port)
                    .encodedPath(base.encodedPath.trimEnd('/') + orig.encodedPath)
                    .build()
                chain.proceed(chain.request().newBuilder().url(target).header("Authorization", "Bearer ${BuildConfig.API_TOKEN}").build())
            })
            .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
            .build()
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(TravelApi::class.java)
    }
}
