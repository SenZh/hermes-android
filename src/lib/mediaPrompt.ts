/**
 * 客户端能力说明：让模型知道在这个 Android 客户端里怎么把文件交给用户。
 *
 * 走 `prompt.submit` 的 `api_text` 字段——它存进数据库的是 `text`（用户看到的），
 * 模型读到的是 `api_text`。因此这段说明不会出现在用户的聊天气泡里，但会留在会话历史中，
 * 后续轮次模型依然能看见。
 *
 * 只在会话的第一条用户消息上注入，避免每轮重复烧 token。
 */

export const MEDIA_CAPABILITY_PROMPT = `[客户端能力 · 仅模型可见，用户看不到这段]

当前对话来自 Hermes Android 客户端。需要把文件、图片或文档交给用户时，按下面的格式输出，不要贴 base64、不要把全文粘进正文、也不要只口头说路径：

MEDIA:/服务端绝对路径

客户端会把它渲染成可点击的卡片，点开能在应用内预览，也能保存到手机。

规则：
1. 路径必须是服务端上真实存在的绝对路径（例如 /opt/data/workspace/report.md）。相对路径不会被识别。
2. 每个文件单独占一行，一行一个 MEDIA:。
3. 图片、PDF、Markdown、纯文本、压缩包、APK 都用同一种写法。
4. MEDIA: 后面直接跟路径，不要加反引号、列表符号或其它标点。
5. 要交付的文件先写到磁盘再引用；不要在正文里内联文件内容。

示例：
已经生成好了。
MEDIA:/opt/data/workspace/reports/2026-10-27.md`

/**
 * 首轮才追加能力说明；后续轮次原样返回，避免重复占用上下文。
 */
export function withMediaCapabilityPrompt(text: string, isFirstTurn: boolean): string {
  if (!isFirstTurn) return text
  return `${text}\n\n${MEDIA_CAPABILITY_PROMPT}`
}
