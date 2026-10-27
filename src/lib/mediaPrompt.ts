/**
 * 客户端能力说明：让模型知道在这个 Android 客户端里怎么把文件交给用户。
 *
 * ## 为什么不走 api_text
 *
 * gateway 的 `PromptSubmitParams`（`tui_gateway/contracts/prompt_voice.py`）用 pydantic
 * `extra=forbid`，字段表里**没有** `api_text`；`session_cli_turn.py` 里的 `_SUBMIT_FIELDS`
 * 是进程内部的 admission 字段，不经过 wire 校验。客户端传它会被 registry 拒掉：
 * `invalid params for prompt.submit: api_text: Extra inputs are not permitted`。
 *
 * ## 现在怎么做
 *
 * 拼进首轮的用户文本，用一段**明确的分隔标记**包住；客户端所有渲染入口先过
 * `stripCapability()` 把它剥掉，所以用户看不到，而模型能读到。
 *
 * 代价：这段文字会进服务端历史、占首轮 token。只在首轮拼一次，可以接受。
 *
 * ## 路径
 *
 * **不得硬编码任何路径前缀。** 工作区随部署变化，由调用方从服务端取真实值传进来；
 * 取不到就完全不给示例，让模型自己 pwd 确认。
 */

/** 分隔标记。渲染层据此剥离，必须足够独特，不能出现在正常对话里。 */
export const CAPABILITY_MARKER = '\n\n<!--hermes-client-capability:v1-->\n'

export const MEDIA_CAPABILITY_PROMPT = `[客户端能力 · 仅模型可见，用户看不到这段]

当前对话来自 Hermes Android 客户端。需要把文件、图片或文档交给用户时，按下面的格式输出，不要贴 base64、不要把全文粘进正文、也不要只口头说路径：

MEDIA:/服务端绝对路径

客户端会把它渲染成可点击的卡片，点开能在应用内预览，也能保存到手机。

规则：
1. 路径必须是服务端上真实存在的绝对路径。相对路径、~、环境变量都不会被识别。
2. 每个文件单独占一行，一行一个 MEDIA:。
3. 图片、PDF、Markdown、纯文本、压缩包、APK 都用同一种写法。
4. MEDIA: 后面直接跟路径，不要加反引号、列表符号或其它标点。
5. 要交付的文件先写到磁盘再引用；不要在正文里内联文件内容。
6. 不确定当前工作目录时，先执行 pwd 或 ls 确认，再拼路径——不要假设前缀。`

/**
 * 首轮把能力说明接到用户文本后面；后续轮次原样返回。
 *
 * @param workspaceCwd 服务端返回的真实工作区绝对路径；为 null 时不提供示例
 */
export function withMediaCapabilityPrompt(
  text: string,
  isFirstTurn: boolean,
  workspaceCwd: string | null = null,
): string {
  if (!isFirstTurn) return text

  // 示例只用真实路径；拿不到就干脆不给示例，避免模型照抄一个不存在的目录。
  const example = workspaceCwd
    ? `\n\n示例（当前会话工作区是 ${workspaceCwd}）：\n已经生成好了。\nMEDIA:${workspaceCwd.replace(/\/+$/, '')}/reports/notes.md`
    : ''

  return `${text}${CAPABILITY_MARKER}${MEDIA_CAPABILITY_PROMPT}${example}`
}

/**
 * 渲染前剥离能力说明。所有显示用户文本的地方都必须先过它，
 * 否则发送时气泡正常、从服务端重新加载的历史里却会冒出这一大段。
 */
export function stripCapability(text: string): string {
  const at = text.indexOf(CAPABILITY_MARKER)
  if (at < 0) return text
  return text.slice(0, at).trimEnd()
}
