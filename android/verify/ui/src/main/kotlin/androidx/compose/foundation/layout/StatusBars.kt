// 데스크톱 Compose 에 없는 Android 전용 API 의 shim(컴파일 검증 전용).
package androidx.compose.foundation.layout
import androidx.compose.ui.Modifier
fun Modifier.statusBarsPadding(): Modifier = this
