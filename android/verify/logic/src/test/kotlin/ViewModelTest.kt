import com.travelrec.data.Recommendation
import com.travelrec.data.Weights
import com.travelrec.ui.RecommendViewModel
import com.travelrec.ui.UiState
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.*

class ViewModelTest {
    private suspend fun RecommendViewModel.await(ms: Long = 15_000, pred: (UiState) -> Boolean): UiState =
        withTimeout(ms) { state.first(pred) }

    private fun searched(): Pair<RecommendViewModel, List<Recommendation>> = runBlocking {
        val vm = RecommendViewModel()
        vm.update { copy(startDate = "2026-12-20", endDate = "2026-12-24", budgetMan = "300", travelers = "2", scope = "both", tags = setOf("미식")) }
        vm.search()
        val s = vm.await { it.response != null }
        vm to s.response!!.results
    }

    @Test fun searchStoresTheRequestUsedForTheList() = runBlocking<Unit> {
        val (vm, results) = searched()
        assertTrue(results.size >= 2)
        val req = vm.state.value.lastRequest!!
        assertEquals(3_000_000L, req.budgetKRW)
        assertEquals(2, req.travelers)
        assertEquals(listOf("미식"), req.tags)
    }

    @Test fun detailUsesListRequestEvenIfInputsChangedAfterSearch() = runBlocking<Unit> {
        val (vm, results) = searched()
        val r = results.first()
        // 검색 후 입력창을 바꿔도 상세는 "목록을 만든 요청" 으로 호출돼야 한다
        vm.update { copy(budgetMan = "1", travelers = "9", tags = emptySet(), weights = Weights(cost = 1.0, weather = 0.0, event = 0.0, lodging = 0.0, poi = 0.0, logistics = 0.0)) }
        vm.openDetail(r)
        val s = vm.await { it.detail?.data != null }
        val d = s.detail!!.data!!
        assertEquals(r.destinationId, d.destination.id)
        assertEquals(2, d.trip.travelers)
        assertEquals(3_000_000L, d.trip.budgetKRW)
        assertEquals(r.totalScore, d.recommendation.totalScore, 1e-9) // 목록과 같은 점수
        assertFalse(s.detail!!.loading)
        assertNull(s.detail!!.error)
    }

    @Test fun detailStartsInLoadingStateThenLoads() = runBlocking<Unit> {
        val (vm, results) = searched()
        vm.openDetail(results.first())
        val first = vm.state.value.detail!!
        assertTrue(first.loading) // 호출 직후 즉시 로딩 상태
        assertEquals(results.first().name, first.name)
        vm.await { it.detail?.loading == false }
    }

    @Test fun lateResponseOfPreviousDestinationNeverOverwritesCurrentOne() = runBlocking<Unit> {
        val (vm, results) = searched()
        val a = results[0]; val b = results[1]
        vm.openDetail(a)
        vm.openDetail(b) // 곧바로 다른 목적지
        val s = vm.await { it.detail?.data != null }
        assertEquals(b.destinationId, s.detail!!.destinationId)
        assertEquals(b.destinationId, s.detail!!.data!!.destination.id)
        delay(800) // A 의 응답이 뒤늦게 와도 B 가 유지돼야 한다
        assertEquals(b.destinationId, vm.state.value.detail!!.data!!.destination.id)
    }

    @Test fun closeDetailCancelsAndClears() = runBlocking<Unit> {
        val (vm, results) = searched()
        vm.openDetail(results.first())
        vm.closeDetail()
        assertNull(vm.state.value.detail)
        delay(800)
        assertNull(vm.state.value.detail) // 응답이 와도 닫힌 화면을 다시 열지 않는다
        assertNotNull(vm.state.value.response) // 목록은 그대로
    }

    @Test fun failureShowsErrorAndRetryReloads() = runBlocking<Unit> {
        val (vm, results) = searched()
        vm.openDetail(results.first().copy(destinationId = "atlantis")) // 서버가 404
        val s = vm.await { it.detail?.error != null }
        assertFalse(s.detail!!.loading)
        assertTrue(s.detail!!.error!!.contains("불러오지 못했습니다"))
        vm.retryDetail()
        assertTrue(vm.state.value.detail!!.loading) // 재시도 즉시 로딩 상태로 복귀, 오류 제거
        assertNull(vm.state.value.detail!!.error)
        vm.await { it.detail?.error != null } // 같은 id 라 다시 실패
    }

    @Test fun openDetailBeforeAnySearchDoesNothing() {
        val vm = RecommendViewModel()
        vm.openDetail(Recommendation("busan", "부산", "KR", 1.0, 1, emptyList(), emptyList(), dataNotes = emptyList(), links = emptyList()))
        assertNull(vm.state.value.detail)
    }

    @Test fun invalidInputsShowErrorAndKeepNoRequest() {
        val vm = RecommendViewModel()
        vm.update { copy(budgetMan = "abc") }
        vm.search()
        assertEquals("예산과 인원은 숫자로 입력하세요", vm.state.value.error)
        assertNull(vm.state.value.lastRequest)
    }
}
