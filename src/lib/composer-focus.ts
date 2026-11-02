/**
 * 把焦点交回主输入框。
 *
 * assistant-ui 的 composer runtime 没有暴露 focus()，所以直接拿 DOM。
 * `data-slot` 由 chat/composer.tsx 里的 <ComposerPrimitive.Input> 提供，改动时保持同步。
 */
export function focusComposer(options: { caret?: 'start' | 'end' } = {}) {
  const { caret = 'end' } = options
  // 优先用 data-slot，退回 class——两者任一被改掉都还能找到输入框
  const input =
    document.querySelector<HTMLTextAreaElement>(
      '[data-slot="composer-input"]',
    ) ?? document.querySelector<HTMLTextAreaElement>('.aui-composer-input')
  if (!input) return

  input.focus({ preventScroll: true })

  // 光标位置必须等 React 把新文本提交到 DOM 之后再算，
  // 否则 setText 刚调用时 .value 还是旧值，光标会落到 0。
  requestAnimationFrame(() => {
    try {
      const position = caret === 'start' ? 0 : input.value.length
      input.setSelectionRange(position, position)
    } catch {
      /* textarea 已被卸载 */
    }
  })
}
