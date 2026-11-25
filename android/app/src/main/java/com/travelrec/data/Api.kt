package com.travelrec.data

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.travelrec.BuildConfig
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.POST

interface TravelApi {
    @POST("recommend")
    suspend fun recommend(@Body request: RecommendRequest): RecommendResponse
}

/** 수동 DI. 규모가 커지면 Hilt 로 전환. 앱에는 외부 API 키 대신 자체 서버 토큰만 둔다. */
object ApiProvider {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    val api: TravelApi by lazy {
        val client = OkHttpClient.Builder()
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
