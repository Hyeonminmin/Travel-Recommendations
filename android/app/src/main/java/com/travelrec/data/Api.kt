package com.travelrec.data

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.travelrec.BuildConfig
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
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

/** 수동 DI. 규모가 커지면 Hilt 로 전환. 앱에는 외부 API 키 대신 자체 서버 토큰만 둔다. */
object ApiProvider {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    val api: TravelApi by lazy {
        val client = OkHttpClient.Builder()
            // 서버 캐시가 비어 있는 첫 요청은 외부 API 를 여러 개 부르느라 10초(OkHttp 기본)를 넘길 수 있다
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(Interceptor { chain ->
                chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer ${BuildConfig.API_TOKEN}").build())
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
