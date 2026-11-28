import com.travelrec.BuildConfig
import com.travelrec.data.*
import com.travelrec.ui.RecommendViewModel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.net.ConnectException
import kotlin.test.*

/** 폰에서 서버 주소를 앱 안에서 바꿀 수 있는지(재빌드 없이) 검증한다. */
class ServerUrlTest {
    private val initial = BuildConfig.API_BASE_URL // 테스트용 실제 백엔드(Mock 모드)
    private val port = java.net.URI(initial).port
    private val req = RecommendRequest(startDate = "2026-12-20", endDate = "2026-12-24", budgetKRW = 3_000_000, travelers = 2)

    @AfterTest fun restore() { ApiProvider.setBaseUrl(initial) }

    @Test fun normalizesAndValidates() {
        assertEquals("http://192.168.0.10:8080/", normalizeBaseUrl("http://192.168.0.10:8080"))
        assertEquals("http://192.168.0.10:8080/", normalizeBaseUrl("  http://192.168.0.10:8080/  "))
        assertEquals("https://example.com/api/", normalizeBaseUrl("https://example.com/api"))
        assertEquals("https://example.com/api/", normalizeBaseUrl("https://example.com/api///"))
        assertEquals("http://localhost:8080/", normalizeBaseUrl("http://localhost:8080"))
        for (bad in listOf("", "   ", "abc", "192.168.0.10:8080", "ftp://x.com", "http://", "http://x.com/?a=b", "http://x.com/#frag", "javascript:alert(1)")) {
            assertNull(normalizeBaseUrl(bad), "거부돼야 함: '$bad'")
        }
    }

    @Test fun invalidInputKeepsCurrentServer() {
        val before = ApiProvider.currentBaseUrl
        assertNull(ApiProvider.setBaseUrl("not a url"))
        assertEquals(before, ApiProvider.currentBaseUrl)
    }

    @Test fun changingTheServerRedirectsRequestsWithoutRebuild() = runBlocking<Unit> {
        assertTrue(ApiProvider.api.recommend(req).results.isNotEmpty()) // 기본 서버로 성공
        ApiProvider.setBaseUrl("http://localhost:1/") // 아무도 듣지 않는 포트
        assertFailsWith<ConnectException> { ApiProvider.api.recommend(req) } // 요청이 새 주소로 갔다는 증거
        ApiProvider.setBaseUrl("http://127.0.0.1:$port") // 같은 서버, 다른 표기(포트 숫자만 주소에 둠, 끝 '/' 없이도 허용)
        assertTrue(ApiProvider.api.recommend(req).results.isNotEmpty())
        assertTrue(ApiProvider.api.destination("busan", req).withinBudget)
    }

    @Test fun pathPrefixIsApplied() = runBlocking<Unit> {
        ApiProvider.setBaseUrl("http://localhost:$port/api/")
        val e = assertFailsWith<retrofit2.HttpException> { ApiProvider.api.recommend(req) }
        assertEquals(404, e.code()) // 서버에는 /api/recommend 가 없다 → 접두사가 붙어서 요청됨
    }

    @Test fun viewModelSavesValidAddressAndNotifiesStorage() = runBlocking<Unit> {
        val vm = RecommendViewModel()
        vm.update { copy(startDate = "2026-12-20", endDate = "2026-12-24", budgetMan = "300", travelers = "2") }
        vm.search()
        withTimeout(15_000) { vm.state.first { it.response != null } }
        var saved: String? = null
        vm.onServerUrlSaved = { saved = it }
        vm.update { copy(serverUrl = "http://localhost:$port") }
        vm.saveServerUrl()
        assertEquals("http://localhost:$port/", saved)
        assertEquals("http://localhost:$port/", ApiProvider.currentBaseUrl)
        val s = vm.state.value
        assertEquals("http://localhost:$port/", s.serverUrl)
        assertNull(s.response) // 이전 서버 기준 결과는 비운다
        assertNull(s.lastRequest)
        assertNull(s.detail)
        assertTrue(s.serverMessage!!.startsWith("저장했습니다"))
    }

    @Test fun viewModelRejectsInvalidAddress() {
        val vm = RecommendViewModel()
        val before = ApiProvider.currentBaseUrl
        var called = false
        vm.onServerUrlSaved = { called = true }
        vm.update { copy(serverUrl = "192.168.0.10") }
        vm.saveServerUrl()
        assertFalse(called)
        assertEquals(before, ApiProvider.currentBaseUrl)
        assertTrue(vm.state.value.serverMessage!!.contains("올바른 주소가 아닙니다"))
    }

    @Test fun inputFieldStartsWithCurrentServer() {
        assertEquals(ApiProvider.currentBaseUrl, RecommendViewModel().state.value.serverUrl)
    }
}
