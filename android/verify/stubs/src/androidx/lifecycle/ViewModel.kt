// 검증용 스텁: androidx ViewModel 의 사용 범위(상속, viewModelScope)만 흉내 낸다. 실제 앱은 androidx.lifecycle 을 쓴다.
package androidx.lifecycle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
// 하네스용 스텁: 실제 androidx ViewModel 의 사용 범위(상속, viewModelScope)만 흉내 낸다. (실제는 Dispatchers.Main.immediate)
abstract class ViewModel { protected open fun onCleared() {}; fun clearForTest() { scopes.remove(this)?.cancel(); onCleared() } }
private val scopes = java.util.concurrent.ConcurrentHashMap<ViewModel, CoroutineScope>()
val ViewModel.viewModelScope: CoroutineScope get() = scopes.getOrPut(this) { CoroutineScope(SupervisorJob() + Dispatchers.Default) }
