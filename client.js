/**
 * Browser half: the context orb.
 *
 * A small floating orb above the composer shows the displayed session's
 * context window as a quiet green liquid wave and a white percentage. It is
 * registered into the Conversation's `conversation.input.overlay` slot, so it
 * exists exactly while a session is on screen and re-seeds itself whenever the
 * window switches sessions. Clicking it opens the Host's context breakdown;
 * double-clicking it runs the Host's own `/compact` command and plays a vortex
 * that condenses the old window into the new one.
 *
 * Everything is scoped to this browser plugin: the registration, the style
 * sheet, the portals and the animation frame all ride the plugin fiber, so a
 * reload or a disable leaves nothing behind.
 */

window.__ModuleLoader__.load({
  id: '@xiaozou-wine/context-orb',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const createPortal = ReactDOM.createPortal
    const useState = React.useState
    const useEffect = React.useEffect
    const useMemo = React.useMemo
    const useRef = React.useRef
    const useCallback = React.useCallback

    /** Locale namespace owned by the orb; both baseline dictionaries are registered. */
    const NS = 'contextOrb'

    /** Orb diameter in CSS pixels; the wave geometry uses the same coordinate space. */
    const ORB_SIZE = 46

    /** Gap between the orb and the composer card's top edge. */
    const ORB_GAP = 10

    /** Smallest distance kept between the orb and a viewport edge. */
    const ORB_EDGE = 10

    /** Click delay split: a second press inside this window is a compact gesture. */
    const DOUBLE_PRESS_MS = 220

    const TAU = Math.PI * 2

    /** Style element marker, so a reload can drop a stale instance's sheet. */
    const STYLE_ATTR = 'data-dsh-context-orb'

    /** Where a hand-placed orb remembers its viewport coordinates. */
    const ORB_POSITION_KEY = 'contextOrb.position.v1'

    /** Pointer travel, in pixels, that turns a press into a drag instead of a click. */
    const DRAG_THRESHOLD = 4

    /** English dictionary; every orb string lives in this namespace. */
    const en = {
      'orb.label': 'Context window {percent} used',
      'orb.loading': 'Context usage is loading',
      'orb.aria': 'Context orb. {percent} of the context window used. Click for details, double-click to compact, drag to move, Home resets the position.',
      'panel.title': 'Context window',
      'panel.used': '{percent}% used',
      'panel.tokens': '~{used} / {window}',
      'panel.system': 'System prompt',
      'panel.tools': 'Tools',
      'panel.messages': 'Conversation',
      'panel.free': 'Free ~{free}',
      'panel.hint': 'Double-click to compact · drag to move',
      'panel.busyHint': 'Available when this reply finishes',
      'panel.compact': 'Compact',
      'panel.close': 'Close',
      'notice.busy': 'Finish the current reply first',
      'notice.notReady': 'This session is still opening',
      'notice.noUsage': 'No usage reported yet',
      'stage.working': 'Compacting context',
      'stage.workingSub': 'condensing history, keeping the essentials',
      'stage.released': 'Context compacted',
      'stage.transition': '{before}% → {after}%',
      'stage.freed': '≈{tokens} tokens released',
      'stage.failed': 'Could not compact',
      'stage.close': 'Dismiss',
      'dock.working': 'Compacting context…',
      'dock.workingDetail': 'Condensing older history and keeping the essentials',
      'dock.revealed': 'Context compacted',
      'dock.revealedDetail': '≈{tokens} released · {before}% → {after}%',
      'dock.revealedDetailPlain': '{before}% → {after}%',
      'dock.failed': 'Could not compact',
      'error.busy': 'Finish the current reply first',
      'error.empty': 'Nothing to compact yet',
      'error.cancelled': 'Compaction was cancelled',
      'error.unsupported': 'No compactable history right now',
      'error.transport': 'The Host did not answer',
      'error.unavailable': 'Compaction is unavailable',
      'error.failed': 'The Host refused this compaction',
    }

    /** Chinese dictionary; the other baseline locale. */
    const zh = {
      'orb.label': '上下文窗口已用 {percent}',
      'orb.loading': '正在读取上下文占用',
      'orb.aria': '上下文悬浮球。上下文窗口已用 {percent}。单击查看详情，双击压缩上下文，拖动可移动位置，按 Home 键复位。',
      'panel.title': '上下文窗口',
      'panel.used': '已用 {percent}%',
      'panel.tokens': '~{used} / {window}',
      'panel.system': '系统提示',
      'panel.tools': '工具定义',
      'panel.messages': '对话内容',
      'panel.free': '剩余 ~{free}',
      'panel.hint': '双击压缩 · 拖动可移动',
      'panel.busyHint': '当前回复完成后可用',
      'panel.compact': '压缩',
      'panel.close': '关闭',
      'notice.busy': '当前回复完成后才能压缩',
      'notice.notReady': '这个会话还在打开',
      'notice.noUsage': '还没有用量数据',
      'stage.working': '正在压缩上下文',
      'stage.workingSub': '整理历史，只保留要点',
      'stage.released': '上下文已压缩',
      'stage.transition': '{before}% → {after}%',
      'stage.freed': '释放约 {tokens} tokens',
      'stage.failed': '暂时无法压缩',
      'stage.close': '关闭',
      'dock.working': '正在压缩…',
      'dock.workingDetail': '整理较早的历史，只保留要点',
      'dock.revealed': '上下文已压缩',
      'dock.revealedDetail': '释放约 {tokens} · {before}% → {after}%',
      'dock.revealedDetailPlain': '{before}% → {after}%',
      'dock.failed': '暂时无法压缩',
      'error.busy': '当前回复完成后才能压缩',
      'error.empty': '还没有可压缩的历史',
      'error.cancelled': '压缩已取消',
      'error.unsupported': '当前没有可压缩的历史',
      'error.transport': 'Host 没有响应',
      'error.unavailable': '当前无法压缩',
      'error.failed': 'Host 拒绝了这次压缩',
    }

    /**
     * All orb styling. Class names carry a `dsh-ctx-orb-` prefix and every
     * colour is literal: the orb is its own little surface in both themes, and
     * the green is deliberately low-key rather than a theme accent.
     */
    const CSS = `
.dsh-ctx-orb-anchor {
  display: block;
  width: 100%;
  height: 0;
  pointer-events: none;
}
.dsh-ctx-orb-portal {
  position: fixed;
  z-index: 620;
  width: 46px;
  height: 46px;
  transition: opacity 200ms ease;
}
.dsh-ctx-orb-portal[data-busy='true'] {
  opacity: 0;
  pointer-events: none;
}
.dsh-ctx-orb {
  position: relative;
  display: block;
  box-sizing: border-box;
  width: 46px;
  height: 46px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: grab;
  -webkit-tap-highlight-color: transparent;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  animation: dsh-ctx-orb-pop 460ms cubic-bezier(0.2, 0.85, 0.25, 1.12);
  transition: transform 170ms ease;
}
.dsh-ctx-orb:hover { transform: translateY(-1px) scale(1.045); }
.dsh-ctx-orb:active { transform: scale(0.955); }
.dsh-ctx-orb[data-dragging='true'] { cursor: grabbing; transform: scale(1.03); }
.dsh-ctx-orb[data-dragging='true']:hover { transform: scale(1.03); }
.dsh-ctx-orb:focus-visible {
  outline: 2px solid rgba(150, 224, 185, 0.85);
  outline-offset: 3px;
}
.dsh-ctx-orb-glass {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background:
    radial-gradient(130% 120% at 30% 16%, rgba(74, 104, 88, 0.6), rgba(13, 22, 17, 0.72) 68%),
    rgba(14, 24, 19, 0.66);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow:
    0 6px 18px rgba(6, 14, 10, 0.24),
    inset 0 1px 1px rgba(255, 255, 255, 0.2),
    inset 0 -8px 14px rgba(0, 0, 0, 0.16);
  -webkit-backdrop-filter: blur(7px) saturate(1.05);
  backdrop-filter: blur(7px) saturate(1.05);
  overflow: hidden;
}
.dsh-ctx-orb-liquid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.dsh-ctx-orb-sheen {
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: 50%;
  background: radial-gradient(120% 85% at 30% 6%, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0) 46%);
  pointer-events: none;
}
.dsh-ctx-orb-wave-a { animation: dsh-ctx-orb-drift-a 7.6s linear infinite; }
.dsh-ctx-orb-wave-b { animation: dsh-ctx-orb-drift-b 5.3s linear infinite; }
.dsh-ctx-orb-value {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-family: var(--dsw-font-family, inherit);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.3px;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
.dsh-ctx-orb-value small {
  margin-left: 0.5px;
  font-size: 8.5px;
  font-weight: 600;
  opacity: 0.82;
}
.dsh-ctx-orb-portal[data-known='false'] .dsh-ctx-orb-value {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.6;
}
.dsh-ctx-orb-notice {
  position: absolute;
  right: calc(100% + 9px);
  bottom: 7px;
  z-index: 1;
  box-sizing: border-box;
  padding: 5px 9px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(19, 29, 24, 0.94);
  color: #dcefe4;
  font-family: var(--dsw-font-family, inherit);
  font-size: 11px;
  line-height: 1.35;
  white-space: nowrap;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.24);
  pointer-events: none;
  animation: dsh-ctx-orb-notice-in 170ms ease-out;
}
.dsh-ctx-orb-notice[data-side='right'] {
  right: auto;
  left: calc(100% + 9px);
  animation-name: dsh-ctx-orb-notice-in-right;
}
.dsh-ctx-orb-panel {
  position: absolute;
  right: 0;
  bottom: calc(100% + 10px);
  z-index: 2;
  box-sizing: border-box;
  width: 276px;
  padding: 12px 14px 11px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: linear-gradient(180deg, rgba(23, 34, 28, 0.96), rgba(13, 22, 17, 0.975));
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  color: rgba(240, 248, 243, 0.92);
  font-family: var(--dsw-font-family, inherit);
  font-size: 12px;
  line-height: 1.45;
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  transform-origin: calc(100% - 23px) 100%;
  animation: dsh-ctx-orb-panel-in 180ms cubic-bezier(0.2, 0.8, 0.3, 1);
}
/* A hand-dragged orb can sit near the top edge; the panel then opens below it
   instead of off the viewport. */
.dsh-ctx-orb-panel[data-flip='true'] {
  top: calc(100% + 10px);
  bottom: auto;
  transform-origin: calc(100% - 23px) 0;
  animation-name: dsh-ctx-orb-panel-in-below;
}
.dsh-ctx-orb-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.dsh-ctx-orb-title {
  font-size: 11px;
  letter-spacing: 0.02em;
  color: rgba(202, 226, 213, 0.62);
}
.dsh-ctx-orb-percent {
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.6px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: #eafaf1;
}
.dsh-ctx-orb-percent small {
  margin-left: 1px;
  font-size: 11px;
  font-weight: 500;
  opacity: 0.66;
}
.dsh-ctx-orb-tokens {
  margin-top: 4px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: rgba(196, 222, 208, 0.55);
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.dsh-ctx-orb-bar {
  display: flex;
  height: 6px;
  margin: 10px 0 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.085);
  overflow: hidden;
}
.dsh-ctx-orb-seg {
  height: 100%;
  min-width: 2px;
  border-radius: 0;
  transition: width 420ms cubic-bezier(0.2, 0.8, 0.3, 1);
}
.dsh-ctx-orb-rows { display: grid; gap: 5px; }
.dsh-ctx-orb-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
}
.dsh-ctx-orb-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 2px;
}
.dsh-ctx-orb-row-label {
  flex: 1;
  color: rgba(220, 238, 228, 0.64);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-ctx-orb-row-value {
  font-variant-numeric: tabular-nums;
  color: rgba(240, 248, 243, 0.85);
}
.dsh-ctx-orb-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.dsh-ctx-orb-hint {
  min-width: 0;
  font-size: 10.5px;
  color: rgba(200, 224, 211, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-ctx-orb-compact {
  flex: none;
  appearance: none;
  margin: 0;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(159, 227, 193, 0.34);
  background: rgba(159, 227, 193, 0.1);
  color: #bfe9d3;
  font-family: inherit;
  font-size: 11px;
  line-height: 1.5;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
}
.dsh-ctx-orb-compact:hover {
  background: rgba(159, 227, 193, 0.18);
  border-color: rgba(159, 227, 193, 0.55);
}
.dsh-ctx-orb-stage {
  position: fixed;
  z-index: 1300;
  left: 50%;
  top: 50%;
  box-sizing: border-box;
  width: 336px;
  margin: 0;
  padding: 14px 14px 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 22px;
  border: 1px solid rgba(159, 227, 193, 0.16);
  background:
    radial-gradient(120% 90% at 50% 0%, rgba(40, 68, 53, 0.92), rgba(12, 21, 17, 0.96) 62%),
    rgba(11, 19, 15, 0.96);
  box-shadow:
    0 26px 72px rgba(0, 0, 0, 0.38),
    inset 0 1px 0 rgba(255, 255, 255, 0.07),
    inset 0 -20px 44px rgba(0, 0, 0, 0.18);
  transform: translate(-50%, -50%);
  pointer-events: none;
  font-family: var(--dsw-font-family, inherit);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
  animation: dsh-ctx-orb-stage-in 280ms cubic-bezier(0.2, 0.8, 0.3, 1);
}
.dsh-ctx-orb-stage[data-closing='true'] {
  opacity: 0;
  transition: opacity 340ms ease;
}
.dsh-ctx-orb-stage-fx {
  position: relative;
  flex: none;
  width: 300px;
  height: 270px;
}
.dsh-ctx-orb-stage canvas {
  position: absolute;
  inset: 0;
  width: 300px;
  height: 270px;
  display: block;
}
.dsh-ctx-orb-core {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
}
.dsh-ctx-orb-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #c3f0d9;
  box-shadow: 0 0 18px rgba(160, 235, 197, 0.85), 0 0 42px rgba(120, 220, 170, 0.35);
  animation: dsh-ctx-orb-pulse 1.9s ease-in-out infinite;
}
.dsh-ctx-orb-big {
  display: flex;
  align-items: baseline;
  color: #eafff5;
  font-size: 54px;
  font-weight: 600;
  letter-spacing: -2.5px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  text-shadow:
    0 0 30px rgba(124, 224, 174, 0.55),
    0 2px 12px rgba(0, 0, 0, 0.45);
}
.dsh-ctx-orb-big small {
  margin-left: 2px;
  font-size: 20px;
  font-weight: 500;
  letter-spacing: -0.5px;
  opacity: 0.72;
}
.dsh-ctx-orb-fail {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 1px solid rgba(238, 196, 138, 0.5);
  color: #f0d6a8;
  font-size: 25px;
  font-weight: 400;
  box-shadow: 0 0 26px rgba(238, 196, 138, 0.22);
}
.dsh-ctx-orb-stage-copy {
  margin-top: 2px;
  text-align: center;
  min-height: 74px;
}
.dsh-ctx-orb-stage-title {
  font-size: 13.5px;
  letter-spacing: 0.03em;
  color: rgba(236, 249, 241, 0.92);
}
.dsh-ctx-orb-stage-sub {
  margin-top: 6px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(196, 222, 208, 0.58);
  animation: dsh-ctx-orb-sub-in 420ms ease-out both;
}
@keyframes dsh-ctx-orb-pop {
  0% { opacity: 0; transform: scale(0.62) rotate(-10deg); }
  55% { opacity: 1; transform: scale(1.06) rotate(2deg); }
  100% { opacity: 1; transform: scale(1) rotate(0deg); }
}
@keyframes dsh-ctx-orb-drift-a {
  from { transform: translateX(0); }
  to { transform: translateX(-26px); }
}
@keyframes dsh-ctx-orb-drift-b {
  from { transform: translateX(0); }
  to { transform: translateX(-18px); }
}
@keyframes dsh-ctx-orb-panel-in {
  from { opacity: 0; transform: translateY(7px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes dsh-ctx-orb-notice-in {
  from { opacity: 0; transform: translateX(4px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes dsh-ctx-orb-notice-in-right {
  from { opacity: 0; transform: translateX(-4px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes dsh-ctx-orb-panel-in-below {
  from { opacity: 0; transform: translateY(-7px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes dsh-ctx-orb-stage-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.86); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@keyframes dsh-ctx-orb-pulse {
  0%, 100% { transform: scale(0.8); opacity: 0.6; }
  50% { transform: scale(1.25); opacity: 1; }
}
@keyframes dsh-ctx-orb-sub-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
/* ------------------------------------------------- compaction status strip */
/* The strip joins the composer stack cards (todo / goal / queue) directly above
   the input card, so this plugin's compaction carries the same visible
   "compacting" state a /compact run leaves in that stack. */
.dsh-ctx-orb-inputdock {
  box-sizing: border-box;
  width: calc(
    100% -
    var(--dsh-composer-side-clearance) -
    var(--dsh-composer-side-clearance) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset)
  );
  margin: 0 auto;
  animation: dsh-ctx-orb-strip-in 220ms ease-out both;
}
.dsh-ctx-orb-strip {
  position: relative;
  isolation: isolate;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: calc(var(--dsh-composer-card-max-width) - 4 * var(--dsh-composer-dock-inset));
  min-height: 36px;
  margin: 0 auto;
  padding: 5px 12px;
  overflow: hidden;
  border: 0;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  box-shadow: var(--dsw-elevation-panel);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family, inherit);
}
.dsh-ctx-orb-strip::before {
  position: absolute;
  z-index: -1;
  inset: 0;
  border-radius: inherit;
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  content: '';
  pointer-events: none;
}
.dsh-ctx-orb-strip-glyph {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-state-business-primary, #2e8f65);
}
.dsh-ctx-orb-strip-spinner {
  box-sizing: border-box;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  opacity: 0.9;
  animation: dsh-ctx-orb-spin 850ms linear infinite;
}
.dsh-ctx-orb-strip-mark {
  font-size: 13px;
  line-height: 1;
  font-weight: 600;
}
.dsh-ctx-orb-strip-label {
  flex: none;
  font-size: 13px;
  line-height: 22px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-ctx-orb-strip-detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary-dimmed));
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.dsh-ctx-orb-strip[data-phase='error'] .dsh-ctx-orb-strip-glyph {
  color: var(--dsw-alias-state-error-primary, #b4543f);
}
/* One thin travelling highlight reads "work in progress" without a spinner
   shouting; it hugs the strip's bottom edge while compacting. */
.dsh-ctx-orb-strip[data-phase='working']::after {
  position: absolute;
  right: 12px;
  bottom: 0;
  left: 12px;
  height: 1.5px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--dsw-alias-state-business-primary, #2e8f65), transparent);
  background-size: 40% 100%;
  background-repeat: no-repeat;
  content: '';
  pointer-events: none;
  opacity: 0.55;
  animation: dsh-ctx-orb-scan 1.8s ease-in-out infinite;
}
@keyframes dsh-ctx-orb-spin {
  to { transform: rotate(360deg); }
}
@keyframes dsh-ctx-orb-scan {
  0% { background-position: -40% 0; }
  100% { background-position: 140% 0; }
}
@keyframes dsh-ctx-orb-strip-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-ctx-orb { animation: none; }
  .dsh-ctx-orb-wave-a, .dsh-ctx-orb-wave-b { animation: none; }
  .dsh-ctx-orb-panel, .dsh-ctx-orb-notice, .dsh-ctx-orb-stage { animation: none; }
  .dsh-ctx-orb-pulse { animation: none; }
  .dsh-ctx-orb-inputdock { animation: none; }
  .dsh-ctx-orb-strip-spinner { animation: none; border-right-color: currentColor; opacity: 0.55; }
  .dsh-ctx-orb-strip[data-phase='working']::after { animation: none; opacity: 0.25; }
}
`

    // ---------------------------------------------------------------- helpers

    /** Keep a value inside a range. */
    function clamp(value, min, max) {
      if (value < min) return min
      if (value > max) return max
      return value
    }

    /**
     * Keep one hand-placed orb fully inside the viewport with an even edge pad.
     * @param left - desired viewport x.
     * @param top - desired viewport y.
     * @returns integral coordinates already clamped for the current viewport.
     */
    function clampOrbPosition(left, top) {
      const viewportWidth = typeof window === 'undefined' ? ORB_SIZE + ORB_EDGE * 2 : window.innerWidth
      const viewportHeight = typeof window === 'undefined' ? ORB_SIZE + ORB_EDGE * 2 : window.innerHeight
      return {
        left: Math.round(clamp(left, ORB_EDGE, Math.max(ORB_EDGE, viewportWidth - ORB_SIZE - ORB_EDGE))),
        top: Math.round(clamp(top, ORB_EDGE, Math.max(ORB_EDGE, viewportHeight - ORB_SIZE - ORB_EDGE))),
      }
    }

    /**
     * Restore the last dragged orb position; a malformed or unreadable store
     * simply falls back to the composer anchoring.
     * @returns stored coordinates clamped to the current viewport, or null.
     */
    function readStoredOrbPosition() {
      try {
        const raw = window.localStorage.getItem(ORB_POSITION_KEY)
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return null
        if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null
        if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null
        return clampOrbPosition(parsed.left, parsed.top)
      } catch (error) {
        return null
      }
    }

    /**
     * Remember a hand-placed orb; storage failures keep the orb movable for
     * this page even when the browser refuses persistence.
     * @param position - viewport coordinates to persist.
     */
    function writeStoredOrbPosition(position) {
      try {
        window.localStorage.setItem(ORB_POSITION_KEY, JSON.stringify(position))
      } catch (error) {
        /* ignore: the position still applies until the page reloads */
      }
    }

    /** Forget the hand-placed orb and return it to the composer anchor. */
    function clearStoredOrbPosition() {
      try {
        window.localStorage.removeItem(ORB_POSITION_KEY)
      } catch (error) {
        /* a blocked storage simply keeps the old stored value */
      }
    }

    /** Standard ease-out curve used by the number tweens. */
    function easeOutCubic(k) {
      const inverted = 1 - k
      return 1 - inverted * inverted * inverted
    }

    /** Whether the page asked for reduced motion. */
    function reducedMotion() {
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }

    /**
     * Bounded display occupancy from the Host's pressure projection.
     * @param pressure - the latest `contextPressure` value, possibly absent.
     * @returns percent plus token counts, or null until numerator and capacity are known.
     */
    function occupancyOf(pressure) {
      if (pressure === undefined || pressure === null) return null
      const used = pressure.projectedTokens !== undefined ? pressure.projectedTokens : pressure.pressureTokens
      const windowSize = pressure.contextWindow
      if (used === undefined || windowSize === undefined || !(windowSize > 0)) return null
      return {
        percent: clamp(used / windowSize * 100, 0, 100),
        usedTokens: used,
        contextWindow: windowSize,
      }
    }

    /**
     * Compact token text for the panel: raw below 1000, then K and M with at
     * most one decimal, matching the conversation's own context meter.
     * @param value - token count.
     * @returns display text.
     */
    function formatTokens(value) {
      if (!Number.isFinite(value)) return '—'
      const scaled = (candidate) => candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10)
      if (value < 1000) return String(Math.round(value))
      if (value < 1000000) return scaled(value / 1000) + 'K'
      return scaled(value / 1000000) + 'M'
    }

    /**
     * Wave palette stops: mint at an empty window, deep green at a full one.
     * Interpolation is linear in HSL, which keeps the hue family stable.
     */
    const PALETTE_STOPS = [
      { at: 0, h: 151, s: 52, l: 72 },
      { at: 40, h: 150, s: 49, l: 60 },
      { at: 70, h: 153, s: 49, l: 47 },
      { at: 90, h: 157, s: 48, l: 38 },
      { at: 100, h: 161, s: 50, l: 32 },
    ]

    /**
     * Interpolated wave hue for one occupancy percentage.
     * @param percent - display percentage.
     * @returns hue, saturation, and lightness stops.
     */
    function colourAt(percent) {
      const value = clamp(percent, 0, 100)
      let lower = PALETTE_STOPS[0]
      let upper = PALETTE_STOPS[PALETTE_STOPS.length - 1]
      for (let index = 1; index < PALETTE_STOPS.length; index += 1) {
        if (value <= PALETTE_STOPS[index].at) {
          lower = PALETTE_STOPS[index - 1]
          upper = PALETTE_STOPS[index]
          break
        }
      }
      const span = upper.at - lower.at
      const k = span === 0 ? 0 : (value - lower.at) / span
      return {
        h: lower.h + (upper.h - lower.h) * k,
        s: lower.s + (upper.s - lower.s) * k,
        l: lower.l + (upper.l - lower.l) * k,
      }
    }

    /** Build an HSL colour string from a colour record. */
    function hsl(colour) {
      return 'hsl(' + Math.round(colour.h) + ' ' + Math.round(colour.s) + '% ' + Math.round(colour.l) + '%)'
    }

    /**
     * Every colour the orb needs for one percentage.
     * @param percent - display percentage.
     * @returns wave colours, highlight, and the canvas tint.
     */
    function wavePalette(percent) {
      const base = colourAt(percent)
      return {
        tint: base,
        back: hsl({ h: base.h + 2, s: clamp(base.s - 4, 0, 100), l: clamp(base.l + 13, 0, 92) }),
        main: hsl(base),
        deep: hsl({ h: base.h + 3, s: clamp(base.s + 4, 0, 100), l: clamp(base.l - 13, 6, 60) }),
      }
    }

    /**
     * SVG path for one liquid wave: a sine top edge and a filled body. The path
     * spans one extra period on both sides so the CSS drift loops seamlessly.
     * @param period - wavelength in user units.
     * @param amplitude - crest height.
     * @param width - clipped ball width.
     * @param height - clipped ball height.
     * @returns path `d` attribute.
     */
    function wavePath(period, amplitude, width, height) {
      const step = period / 2
      let d = 'M ' + String(-period) + ' 0'
      let x = -period
      while (x < width + period) {
        d += ' q ' + String(step / 2) + ' ' + String(-amplitude) + ' ' + String(step) + ' 0'
        d += ' q ' + String(step / 2) + ' ' + String(amplitude) + ' ' + String(step) + ' 0'
        x += period
      }
      d += ' L ' + String(width + period) + ' ' + String(height + 12)
      d += ' L ' + String(-period) + ' ' + String(height + 12) + ' Z'
      return d
    }

    /**
     * Read the shadowed token count out of the Host's compaction result text,
     * such as "Compacted 12 history items (~34567 tokens).".
     * @param text - command result text.
     * @returns the token count, or undefined when the text carries none.
     */
    function parseFreedTokens(text) {
      if (typeof text !== 'string') return undefined
      const marker = text.indexOf('(~')
      if (marker === -1) return undefined
      let cursor = marker + 2
      let digits = ''
      while (cursor < text.length && text[cursor] >= '0' && text[cursor] <= '9') {
        digits += text[cursor]
        cursor += 1
      }
      if (digits === '') return undefined
      const parsed = Number(digits)
      return Number.isFinite(parsed) ? parsed : undefined
    }

    /**
     * Classify a Host command failure into one short, localized reason.
     * @param text - the command result text, when the Host sent one.
     * @returns reason key used by the `error.*` dictionary rows.
     */
    function classifyCompactFailure(text) {
      const source = String(text === undefined || text === null ? '' : text).toLowerCase()
      if (source.indexOf('busy') !== -1 || source.indexOf('not idle') !== -1 || source.indexOf('active compaction') !== -1) return 'busy'
      if (source.indexOf('no compactable') !== -1) return 'empty'
      if (source.indexOf('cancel') !== -1) return 'cancelled'
      if (source.indexOf('summary') !== -1 || source.indexOf('history selected') !== -1) return 'unsupported'
      return 'failed'
    }

    // ------------------------------------------ shared compaction status store

    /**
     * Per-session compaction status shared by the two composer entries: the orb
     * writes what it is doing, and the strip above the input card renders it.
     * Keeping the state outside React is deliberate — the orb and the strip are
     * separate slot entries and must not remount the orb when the report
     * changes.
     */
    const compactionStates = new Map()
    const compactionSubscribers = new Set()
    const IDLE_COMPACTION_STATE = Object.freeze({ phase: 'idle' })

    /**
     * Current status for one session.
     * @param sessionId - session identity.
     * @returns the published state, or the frozen idle state.
     */
    function compactionStateFor(sessionId) {
      const state = compactionStates.get(String(sessionId))
      return state === undefined ? IDLE_COMPACTION_STATE : state
    }

    /**
     * Publish one status change and wake every mounted strip.
     * @param sessionId - session identity.
     * @param state - new status, or null to go idle.
     */
    function publishCompactionState(sessionId, state) {
      const key = String(sessionId)
      if (state === null || state === undefined) {
        if (!compactionStates.has(key)) return
        compactionStates.delete(key)
      } else {
        compactionStates.set(key, state)
      }
      for (const subscriber of Array.from(compactionSubscribers)) {
        try {
          subscriber()
        } catch (error) {
          /* a broken subscriber must not starve the others */
        }
      }
    }

    /**
     * Subscribe one component to its session's compaction status.
     * @param sessionId - session identity.
     * @returns the latest published status.
     */
    function useCompactionState(sessionId) {
      const key = String(sessionId)
      const subscribe = useCallback(function (callback) {
        compactionSubscribers.add(callback)
        return function () { compactionSubscribers.delete(callback) }
      }, [])
      const getSnapshot = useCallback(function () {
        return compactionStateFor(key)
      }, [key])
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    // ------------------------------------------------------- shared animation

    /** Last wave percentage, shared across mounts so a session switch re-seeds from it. */
    let lastOrbPercent = 0

    /**
     * Tween a number toward its target with an ease-out curve. The first render
     * starts from the last value any orb instance displayed, so switching
     * sessions slides the wave from the old level to the new one.
     * @param target - destination value.
     * @param duration - tween length in milliseconds.
     * @returns the current animated value.
     */
    function useAnimatedNumber(target, duration) {
      const initial = Number.isFinite(target) ? lastOrbPercent : 0
      const [value, setValue] = useState(initial)
      const fromRef = useRef(initial)
      const frameRef = useRef(0)
      useEffect(function () {
        const from = fromRef.current
        const to = Number.isFinite(target) ? target : 0
        if (Math.abs(to - from) < 0.01 || reducedMotion()) {
          fromRef.current = to
          lastOrbPercent = to
          setValue(to)
          return undefined
        }
        const started = performance.now()
        const step = function (now) {
          const k = clamp((now - started) / duration, 0, 1)
          const next = from + (to - from) * easeOutCubic(k)
          fromRef.current = next
          lastOrbPercent = next
          setValue(next)
          if (k < 1) frameRef.current = requestAnimationFrame(step)
        }
        frameRef.current = requestAnimationFrame(step)
        return function () {
          cancelAnimationFrame(frameRef.current)
        }
      }, [target, duration])
      return value
    }

    /**
     * Track the composer card the orb hangs above. The anchor is a zero-height
     * span at the card's top edge inside the composer's overlay anchor; the orb
     * itself lives in a body portal with fixed coordinates so no ancestor can
     * clip it.
     * @param anchorRef - ref to the in-slot anchor span.
     * @returns fixed viewport coordinates, or null until laid out.
     */
    function useAnchoredPosition(anchorRef) {
      const [position, setPosition] = useState(null)
      useEffect(function () {
        const anchor = anchorRef.current
        if (anchor === null) return undefined
        let frame = 0
        const settleStart = performance.now()

        const measure = function () {
          const node = anchorRef.current
          if (node === null) return
          const rect = node.getBoundingClientRect()
          if (rect.width <= 0) return
          const viewportWidth = window.innerWidth
          const viewportHeight = window.innerHeight
          const left = Math.round(clamp(
            rect.right - ORB_SIZE,
            ORB_EDGE,
            Math.max(ORB_EDGE, viewportWidth - ORB_SIZE - ORB_EDGE),
          ))
          const top = Math.round(clamp(
            rect.top - ORB_GAP - ORB_SIZE,
            ORB_EDGE,
            Math.max(ORB_EDGE, viewportHeight - ORB_SIZE - ORB_EDGE),
          ))
          setPosition(function (previous) {
            if (previous !== null && previous.left === left && previous.top === top) return previous
            return { left: left, top: top }
          })
        }

        const settle = function () {
          measure()
          if (performance.now() - settleStart < 1300) frame = requestAnimationFrame(settle)
        }
        frame = requestAnimationFrame(settle)

        const card = anchor.closest('[data-composer-card]')
        let observer
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(measure)
          observer.observe(document.documentElement)
          if (card !== null) observer.observe(card)
        }
        const timer = window.setInterval(measure, 600)
        window.addEventListener('resize', measure)
        window.addEventListener('scroll', measure, true)
        return function () {
          cancelAnimationFrame(frame)
          window.clearInterval(timer)
          window.removeEventListener('resize', measure)
          window.removeEventListener('scroll', measure, true)
          if (observer !== undefined) observer.disconnect()
        }
      }, [anchorRef])
      return position
    }

    /**
     * Dismiss a floating surface on an outside press or Escape.
     * @param active - whether the surface is open.
     * @param onDismiss - close callback.
     * @param rootRef - ref to the portal subtree that counts as inside.
     */
    function useOutsideDismiss(active, onDismiss, rootRef) {
      useEffect(function () {
        if (!active) return undefined
        const onPointerDown = function (event) {
          const root = rootRef.current
          if (root !== null && root.contains(event.target)) return
          onDismiss()
        }
        const onKeyDown = function (event) {
          if (event.key === 'Escape') onDismiss()
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return function () {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [active, onDismiss, rootRef])
    }

    // -------------------------------------------------------------- orb glyph

    /** Monotonic id source for per-instance SVG defs. */
    let orbGlyphUid = 0

    /**
     * The ball itself: dark glass, a clipped liquid wave whose level is the
     * animated occupancy, a faint progress ring, and the white percentage.
     */
    function OrbGlyph(props) {
      const uid = useMemo(function () {
        orbGlyphUid += 1
        return orbGlyphUid
      }, [])
      const percent = clamp(props.percent, 0, 100)
      const palette = props.palette
      const known = props.known
      const label = props.label
      // A few percent of liquid always rests in the ball: the wave stays
      // readable at a nearly empty window while the number carries the exact
      // reading and the ring keeps the true proportion.
      const liquidPercent = percent <= 0 ? 0 : Math.min(100, 4 + percent * 0.96)
      const fillTop = ORB_SIZE + 6 - (ORB_SIZE + 10) * liquidPercent / 100
      const clipId = 'dsh-ctx-orb-clip-' + String(uid)
      const gradId = 'dsh-ctx-orb-grad-' + String(uid)
      const ringLength = TAU * 21.3
      const ringDash = ringLength * percent / 100
      const valueText = known ? String(Math.round(percent)) : '–'
      return h('button', {
        type: 'button',
        className: 'dsh-ctx-orb',
        title: label,
        draggable: false,
        'data-dragging': props.dragging ? 'true' : 'false',
        'aria-label': props.aria,
        'aria-haspopup': 'dialog',
        'aria-expanded': props.expanded ? 'true' : 'false',
        onDragStart: function (event) { event.preventDefault() },
        onPointerDown: props.onPointerDown,
        onPointerMove: props.onPointerMove,
        onPointerUp: props.onPointerUp,
        onPointerCancel: props.onPointerCancel,
        onKeyDown: props.onKeyDown,
        onClick: props.onClick,
        onDoubleClick: function (event) { event.preventDefault() },
      },
        h('span', { className: 'dsh-ctx-orb-glass', 'aria-hidden': 'true' }),
        h('svg', {
          className: 'dsh-ctx-orb-liquid',
          viewBox: '0 0 46 46',
          focusable: 'false',
          'aria-hidden': 'true',
        },
          h('defs', null,
            h('clipPath', { id: clipId }, h('circle', { cx: 23, cy: 23, r: 22 })),
            h('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' },
              h('stop', { offset: '0%', stopColor: palette.main }),
              h('stop', { offset: '100%', stopColor: palette.deep }))),
          h('g', { clipPath: 'url(#' + clipId + ')' },
            h('g', {
              className: 'dsh-ctx-orb-level',
              style: { transform: 'translateY(' + fillTop.toFixed(2) + 'px)' },
            },
              h('g', { className: 'dsh-ctx-orb-wave-a' },
                h('path', {
                  d: wavePath(26, 2.7, ORB_SIZE, ORB_SIZE),
                  fill: palette.back,
                  opacity: 0.4,
                })),
              h('g', { className: 'dsh-ctx-orb-wave-b' },
                h('path', {
                  d: wavePath(18, 2.1, ORB_SIZE, ORB_SIZE),
                  fill: 'url(#' + gradId + ')',
                  opacity: 0.95,
                })))),
          h('circle', {
            cx: 23,
            cy: 23,
            r: 21.3,
            fill: 'none',
            stroke: 'rgba(255,255,255,0.13)',
            strokeWidth: 1.1,
          }),
          h('circle', {
            cx: 23,
            cy: 23,
            r: 21.3,
            fill: 'none',
            stroke: palette.back,
            strokeWidth: 1.25,
            strokeLinecap: 'round',
            strokeDasharray: ringDash.toFixed(2) + ' ' + ringLength.toFixed(2),
            transform: 'rotate(-90 23 23)',
            opacity: 0.82,
          })),
        h('span', { className: 'dsh-ctx-orb-sheen', 'aria-hidden': 'true' }),
        h('span', { className: 'dsh-ctx-orb-value' },
          valueText,
          h('small', null, known ? '%' : '')),
      )
    }

    // -------------------------------------------------------------- the panel

    /** Composition rows in bar order; the colours are fixed for legibility. */
    const BREAKDOWN_ROWS = [
      { key: 'systemTokens', label: 'panel.system', colour: '#9fe3c1' },
      { key: 'toolsTokens', label: 'panel.tools', colour: '#63c79a' },
      { key: 'messageTokens', label: 'panel.messages', colour: '#2e8f65' },
    ]

    /**
     * The click-open breakdown: used and total tokens, the composition bar and
     * rows, and the compact affordance for keyboard and touch users.
     */
    function OrbPanel(props) {
      const t = props.t
      const occupancy = props.occupancy
      const breakdown = props.breakdown
      const palette = props.palette
      const running = props.running
      const onCompact = props.onCompact
      const percent = occupancy === null ? 0 : occupancy.percent
      const segmentSource = breakdown === undefined || breakdown === null
        ? null
        : BREAKDOWN_ROWS.map(function (row) {
          return { key: row.key, colour: row.colour, tokens: breakdown[row.key] }
        })
      const segmentTotal = segmentSource === null
        ? 0
        : segmentSource.reduce(function (sum, segment) { return sum + segment.tokens }, 0)
      const segments = segmentSource === null || segmentTotal <= 0
        ? [{ key: 'total', colour: palette.main, width: percent }]
        : segmentSource.map(function (segment) {
          return { key: segment.key, colour: segment.colour, width: percent * segment.tokens / segmentTotal }
        })
      const header = h('div', { className: 'dsh-ctx-orb-head' },
        h('span', { className: 'dsh-ctx-orb-title' }, t('panel.title')),
        h('span', { className: 'dsh-ctx-orb-percent' },
          occupancy === null ? '–' : String(Math.round(percent)),
          h('small', null, '%')))
      const figures = occupancy === null
        ? h('div', { className: 'dsh-ctx-orb-tokens' }, h('span', null, t('notice.noUsage')))
        : h('div', { className: 'dsh-ctx-orb-tokens' },
          h('span', null, t('panel.tokens', {
            used: formatTokens(occupancy.usedTokens),
            window: formatTokens(occupancy.contextWindow),
          })),
          h('span', null, t('panel.free', {
            free: formatTokens(Math.max(0, occupancy.contextWindow - occupancy.usedTokens)),
          })))
      const bar = h('div', { className: 'dsh-ctx-orb-bar', 'aria-hidden': 'true' },
        segments.map(function (segment, index) {
          return h('span', {
            key: segment.key + '-' + String(index),
            className: 'dsh-ctx-orb-seg',
            style: { width: clamp(segment.width, 0, 100).toFixed(2) + '%', background: segment.colour },
          })
        }))
      const rows = segmentSource === null || segmentTotal <= 0
        ? null
        : h('div', { className: 'dsh-ctx-orb-rows' },
          segmentSource.map(function (segment, index) {
            return h('div', { key: segment.key + '-row', className: 'dsh-ctx-orb-row' },
              h('span', { className: 'dsh-ctx-orb-dot', style: { background: segment.colour }, 'aria-hidden': 'true' }),
              h('span', { className: 'dsh-ctx-orb-row-label' }, t(BREAKDOWN_ROWS[index].label)),
              h('span', { className: 'dsh-ctx-orb-row-value' }, '~' + formatTokens(segment.tokens)))
          }))
      const foot = h('div', { className: 'dsh-ctx-orb-foot' },
        h('span', { className: 'dsh-ctx-orb-hint' }, running ? t('panel.busyHint') : t('panel.hint')),
        h('button', {
          type: 'button',
          className: 'dsh-ctx-orb-compact',
          onClick: function (event) {
            event.stopPropagation()
            onCompact()
          },
        }, t('panel.compact')))
      return h('div', {
        className: 'dsh-ctx-orb-panel',
        role: 'dialog',
        'aria-label': t('panel.title'),
        'aria-modal': 'false',
        'data-flip': props.flip ? 'true' : 'false',
      }, header, figures, bar, rows, foot)
    }

    // ------------------------------------------------- compaction input strip

    /**
     * Small settled-state glyph; the working state uses the spinner instead.
     * @param character - check or bang mark.
     * @returns the glyph span.
     */
    function stripMark(character) {
      return h('span', { className: 'dsh-ctx-orb-strip-mark', 'aria-hidden': 'true' }, character)
    }

    /**
     * The strip docked directly above the input card. The orb publishes its
     * compaction phase here, so an orb-triggered run shows the same compacting
     * state in the composer stack that a /compact run does — then dissolves
     * into a short result reading (or the expected failure reason).
     */
    function CompactionDock(props) {
      const t = props.t
      const state = useCompactionState(props.sessionId)
      if (state === null || state === undefined || state.phase === 'idle') return null
      let glyph = null
      let label = ''
      let detail = ''
      if (state.phase === 'working') {
        glyph = h('span', { className: 'dsh-ctx-orb-strip-spinner', 'aria-hidden': 'true' })
        label = t('dock.working')
        detail = t('dock.workingDetail')
      } else if (state.phase === 'revealed') {
        glyph = stripMark('✓')
        label = t('dock.revealed')
        const before = Math.round(state.beforePercent)
        const after = Math.round(state.afterPercent)
        detail = state.freed !== undefined && state.freed > 0
          ? t('dock.revealedDetail', { tokens: formatTokens(state.freed), before: before, after: after })
          : t('dock.revealedDetailPlain', { before: before, after: after })
      } else {
        glyph = stripMark('!')
        label = t('dock.failed')
        detail = t('error.' + (state.failureKind === undefined ? 'failed' : state.failureKind))
      }
      return h('div', { className: 'dsh-ctx-orb-inputdock' },
        h('div', {
          className: 'dsh-ctx-orb-strip',
          'data-phase': state.phase,
          role: 'status',
          'aria-live': 'polite',
        },
          h('span', { className: 'dsh-ctx-orb-strip-glyph' }, glyph),
          h('span', { className: 'dsh-ctx-orb-strip-label' }, label),
          detail === '' ? null : h('span', { className: 'dsh-ctx-orb-strip-detail' }, detail)))
    }

    // ------------------------------------------------------- compression stage

    /** One orbiting context mote. */
    function makeParticles(count) {
      const particles = []
      for (let index = 0; index < count; index += 1) {
        particles.push({
          angle: Math.random() * TAU,
          radius: 0.55 + Math.random() * 0.45,
          scatterX: (Math.random() - 0.5) * 2,
          scatterY: (Math.random() - 0.5) * 2,
          size: 0.7 + Math.random() * 1.5,
          spin: 0.7 + Math.random() * 0.7,
          drift: 0.7 + Math.random() * 0.7,
          alpha: 0.16 + Math.random() * 0.42,
          hue: Math.random(),
          burst: 0.4 + Math.random() * 0.9,
          lastX: 0,
          lastY: 0,
          seeded: false,
        })
      }
      return particles
    }

    /** Fresh canvas state for one compression run. */
    function createFx(mode) {
      const now = performance.now()
      return {
        mode: mode,
        modeAt: now,
        last: now,
        particles: makeParticles(reducedMotion() ? 54 : 150),
        rings: [],
        flashAt: 0,
      }
    }

    /**
     * Paint one frame of the vortex. The stage moves through gather, vortex,
     * collapse, then bloom (success) or abort (failure); every phase is driven
     * off the shared mode clock so React only swaps the caption.
     * @param context - 2d context already scaled to CSS pixels.
     * @param fx - mutable animation state.
     * @param width - stage CSS width.
     * @param height - stage CSS height.
     * @param now - frame timestamp.
     * @param tint - wave hue triplet to tint the particles.
     */
    function drawStage(context, fx, width, height, now, tint) {
      const cx = width / 2
      const cy = height / 2
      const radiusMax = Math.min(width, height) * 0.43
      const dt = clamp((now - fx.last) / 1000, 0, 0.05)
      fx.last = now
      const modeAge = now - fx.modeAt
      if (fx.mode === 'gather' && modeAge > 520) {
        fx.mode = 'vortex'
        fx.modeAt = now
      }
      if (fx.mode === 'collapse' && modeAge > 460) {
        fx.mode = 'bloom'
        fx.modeAt = now
        fx.flashAt = now
        fx.rings = [
          { radius: radiusMax * 0.16, speed: 330, lineWidth: 2.4, alpha: 0.5 },
          { radius: radiusMax * 0.06, speed: 220, lineWidth: 1.4, alpha: 0.36 },
          { radius: 0, speed: 150, lineWidth: 1, alpha: 0.26 },
        ]
      }
      const working = fx.mode === 'gather' || fx.mode === 'vortex'
      const burst = fx.mode === 'bloom'
      const abort = fx.mode === 'abort'

      context.clearRect(0, 0, width, height)

      const glow = context.createRadialGradient(cx, cy, 0, cx, cy, radiusMax * 1.2)
      glow.addColorStop(0, 'hsl(' + String(tint.h) + ' ' + String(tint.s + 8) + '% ' + String(tint.l + 10) + '% / 0.1)')
      glow.addColorStop(0.6, 'hsl(' + String(tint.h) + ' ' + String(tint.s + 4) + '% ' + String(tint.l + 4) + '% / 0.032)')
      glow.addColorStop(1, 'hsl(' + String(tint.h) + ' ' + String(tint.s) + '% ' + String(tint.l) + '% / 0)')
      context.fillStyle = glow
      context.beginPath()
      context.arc(cx, cy, radiusMax * 1.2, 0, TAU)
      context.fill()

      if (working || fx.mode === 'collapse') {
        for (let index = 0; index < 3; index += 1) {
          const ringRadius = radiusMax * (0.42 + index * 0.2)
          const rotation = now / 1000 * (index % 2 === 0 ? 0.55 : -0.4) + index * 1.7
          const span = 1.15 - index * 0.2
          context.beginPath()
          context.strokeStyle = 'hsl(' + String(tint.h + 2) + ' ' + String(tint.s + 6) + '% '
            + String(Math.round(clamp(tint.l + 20, 0, 92))) + '% / ' + String(0.16 - index * 0.035) + ')'
          context.lineWidth = 1.1
          context.arc(cx, cy, ringRadius, rotation, rotation + span)
          context.stroke()
        }
        context.beginPath()
        for (let index = 0; index <= 120; index += 1) {
          const k = index / 120
          const angle = k * Math.PI * 3.4 + now / 2500
          const spiralRadius = radiusMax * (1.06 - k * 0.94)
          const x = cx + Math.cos(angle) * spiralRadius
          const y = cy + Math.sin(angle) * spiralRadius
          if (index === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        }
        context.strokeStyle = 'hsl(' + String(tint.h + 4) + ' ' + String(tint.s + 6) + '% '
          + String(Math.round(clamp(tint.l + 18, 0, 92))) + '% / 0.05)'
        context.lineWidth = 1
        context.stroke()
      }

      const gather = fx.mode === 'gather' ? easeOutCubic(clamp(modeAge / 520, 0, 1)) : 1
      const fade = burst || abort ? clamp(1 - modeAge / 1600, 0, 1) : 1
      const particles = fx.particles
      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index]
        if (working) {
          particle.angle += (0.7 + 2.4 * (1 - particle.radius)) * particle.spin * dt
          particle.radius -= (0.05 + 0.2 * (1 - particle.radius)) * particle.drift * dt
          if (particle.radius < 0.08) {
            particle.radius = 0.86 + Math.random() * 0.12
            particle.angle = Math.random() * TAU
            particle.seeded = false
          }
        } else if (fx.mode === 'collapse') {
          particle.angle += 11 * dt
          particle.radius = Math.max(0.01, particle.radius - (0.5 + 1.5 * (1 - particle.radius)) * dt)
        } else if (burst) {
          particle.radius += particle.burst * dt
          particle.burst *= 0.985
        } else {
          particle.radius += 0.1 * dt
        }
        const radius = particle.radius * radiusMax
        const x = cx + Math.cos(particle.angle) * radius
        const y = cy + Math.sin(particle.angle) * radius
        const scatterX = cx + particle.scatterX * width * 0.46
        const scatterY = cy + particle.scatterY * height * 0.44
        const drawX = scatterX + (x - scatterX) * gather
        const drawY = scatterY + (y - scatterY) * gather
        const alpha = particle.alpha * fade * (working ? clamp(0.4 + particle.radius, 0, 1) : 1)
        if (alpha <= 0.012) continue
        const hue = tint.h - 6 + particle.hue * 18
        const saturation = tint.s + 8
        const lightness = clamp(tint.l + 8 + particle.hue * 12, 0, 92)
        if (working && particle.seeded) {
          context.beginPath()
          context.moveTo(particle.lastX, particle.lastY)
          context.lineTo(drawX, drawY)
          context.strokeStyle = 'hsl(' + String(hue) + ' ' + String(saturation) + '% ' + String(lightness) + '% / ' + String(alpha * 0.3) + ')'
          context.lineWidth = 0.8
          context.stroke()
        }
        context.beginPath()
        context.fillStyle = 'hsl(' + String(hue) + ' ' + String(saturation) + '% ' + String(lightness) + '% / ' + String(alpha) + ')'
        context.arc(drawX, drawY, particle.size, 0, TAU)
        context.fill()
        particle.lastX = drawX
        particle.lastY = drawY
        particle.seeded = true
      }

      let coreAlpha = working ? 0.42 + 0.1 * Math.sin(now / 420) : 0.18
      let coreRadius = radiusMax * 0.19
      if (fx.mode === 'collapse') {
        const k = clamp(modeAge / 460, 0, 1)
        coreRadius *= 1 + k * 1.3
        coreAlpha = 0.35 + k * 0.5
      }
      const core = context.createRadialGradient(cx, cy, 0, cx, cy, coreRadius * 2.4)
      core.addColorStop(0, 'hsl(' + String(tint.h + 6) + ' ' + String(tint.s + 12) + '% '
        + String(Math.round(clamp(tint.l + 26, 0, 96))) + '% / ' + String(coreAlpha) + ')')
      core.addColorStop(0.42, 'hsl(' + String(tint.h + 2) + ' ' + String(tint.s + 8) + '% '
        + String(Math.round(clamp(tint.l + 14, 0, 90))) + '% / ' + String(coreAlpha * 0.45) + ')')
      core.addColorStop(1, 'hsl(' + String(tint.h) + ' ' + String(tint.s) + '% ' + String(tint.l) + '% / 0)')
      context.fillStyle = core
      context.beginPath()
      context.arc(cx, cy, coreRadius * 2.4, 0, TAU)
      context.fill()
      if (working || fx.mode === 'collapse') {
        context.beginPath()
        context.fillStyle = 'hsl(' + String(tint.h + 8) + ' ' + String(tint.s + 14) + '% '
          + String(Math.round(clamp(tint.l + 34, 0, 98))) + '% / 0.9)'
        context.arc(cx, cy, working ? 2.4 : 3.2, 0, TAU)
        context.fill()
      }

      for (let index = 0; index < fx.rings.length; index += 1) {
        const ring = fx.rings[index]
        ring.radius += ring.speed * dt
        ring.speed *= 0.972
        ring.alpha -= dt * 0.5
        if (ring.alpha <= 0.012) continue
        context.beginPath()
        context.strokeStyle = 'hsl(' + String(tint.h + 6) + ' ' + String(tint.s + 10) + '% '
          + String(Math.round(clamp(tint.l + 24, 0, 94))) + '% / ' + String(ring.alpha) + ')'
        context.lineWidth = ring.lineWidth
        context.arc(cx, cy, ring.radius, 0, TAU)
        context.stroke()
      }

      if (fx.flashAt > 0) {
        const k = clamp(1 - (now - fx.flashAt) / 520, 0, 1)
        if (k > 0) {
          const flash = context.createRadialGradient(cx, cy, 0, cx, cy, radiusMax * 0.78)
          flash.addColorStop(0, 'hsl(' + String(tint.h + 10) + ' 70% 90% / ' + String(k * 0.5) + ')')
          flash.addColorStop(1, 'hsl(' + String(tint.h + 10) + ' 70% 90% / 0)')
          context.fillStyle = flash
          context.beginPath()
          context.arc(cx, cy, radiusMax * 0.78, 0, TAU)
          context.fill()
        }
      }

      if (abort) {
        const k = clamp(modeAge / 1600, 0, 1)
        context.beginPath()
        context.strokeStyle = 'hsl(36 68% 72% / ' + String(0.4 * (1 - k)) + ')'
        context.lineWidth = 1.4
        context.arc(cx, cy, radiusMax * (0.35 + k * 0.5), 0, TAU)
        context.stroke()
      }
    }

    /**
     * The compression overlay: a body portal with a canvas vortex and the
     * before/after reading. It stays mounted while the Host works, collapses
     * when the result arrives, and fades itself out afterwards.
     */
    function CompressStage(props) {
      const t = props.t
      const phase = props.phase
      const before = props.before
      const after = props.after
      const beforePercent = before === null || before === undefined ? 0 : before.percent
      const afterPercent = after === null || after === undefined ? beforePercent : after.percent
      const tint = useMemo(function () { return colourAt(beforePercent) }, [beforePercent])
      const tintRef = useRef(tint)
      tintRef.current = tint
      const canvasRef = useRef(null)
      const fxRef = useRef(null)
      const finishedRef = useRef(props.onFinished)
      finishedRef.current = props.onFinished
      const [shownPercent, setShownPercent] = useState(beforePercent)
      const [closing, setClosing] = useState(false)
      if (fxRef.current === null) {
        fxRef.current = createFx(phase === 'working' ? 'gather' : phase === 'revealed' ? 'collapse' : 'abort')
      }

      useEffect(function () {
        const fx = fxRef.current
        if (fx === null) return
        if (phase === 'revealed') {
          fx.mode = 'collapse'
          fx.modeAt = performance.now()
        } else if (phase === 'error') {
          fx.mode = 'abort'
          fx.modeAt = performance.now()
        }
      }, [phase])

      useEffect(function () {
        const canvas = canvasRef.current
        if (canvas === null) return undefined
        const context = canvas.getContext('2d')
        if (context === null) return undefined
        const width = 300
        const height = 270
        const ratio = Math.min(2, window.devicePixelRatio || 1)
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        let frame = 0
        const tick = function (now) {
          const fx = fxRef.current
          if (fx !== null) drawStage(context, fx, width, height, now, tintRef.current)
          frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return function () { cancelAnimationFrame(frame) }
      }, [])

      useEffect(function () {
        if (phase !== 'revealed') {
          setShownPercent(beforePercent)
          return undefined
        }
        if (reducedMotion()) {
          setShownPercent(afterPercent)
          return undefined
        }
        const from = beforePercent
        const to = afterPercent
        const started = performance.now()
        let frame = 0
        const step = function (now) {
          const k = clamp((now - started) / 950, 0, 1)
          setShownPercent(from + (to - from) * easeOutCubic(k))
          if (k < 1) frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
        return function () { cancelAnimationFrame(frame) }
      }, [phase, beforePercent, afterPercent])

      useEffect(function () {
        if (phase === 'working') {
          setClosing(false)
          return undefined
        }
        const hold = phase === 'revealed' ? 2900 : 1900
        const timer = setTimeout(function () { setClosing(true) }, hold)
        return function () { clearTimeout(timer) }
      }, [phase])

      useEffect(function () {
        if (!closing) return undefined
        const timer = setTimeout(function () { finishedRef.current() }, 360)
        return function () { clearTimeout(timer) }
      }, [closing])

      const base = {
        t: t,
        phase: phase,
        before: before,
        after: after,
        freed: props.freed,
        failureKind: props.failureKind,
        onFinished: props.onFinished,
      }
      const working = base.phase === 'working'
      const revealed = base.phase === 'revealed'
      const failed = base.phase === 'error'
      return h('div', {
        className: 'dsh-ctx-orb-stage',
        'data-phase': base.phase,
        'data-closing': closing ? 'true' : 'false',
        role: 'status',
        'aria-live': 'polite',
      },
        h('div', { className: 'dsh-ctx-orb-stage-fx' },
          h('canvas', { ref: canvasRef, 'aria-hidden': 'true' }),
          h('div', { className: 'dsh-ctx-orb-core' },
            working && h('span', { className: 'dsh-ctx-orb-pulse', 'aria-hidden': 'true' }),
            revealed && h('div', { className: 'dsh-ctx-orb-big', 'aria-hidden': 'true' },
              String(Math.round(shownPercent)),
              h('small', null, '%')),
            failed && h('div', { className: 'dsh-ctx-orb-fail', 'aria-hidden': 'true' }, '!'))),
        h('div', { className: 'dsh-ctx-orb-stage-copy' },
          h('div', { className: 'dsh-ctx-orb-stage-title' },
            working ? t('stage.working') : revealed ? t('stage.released') : t('stage.failed')),
          working && h('div', { className: 'dsh-ctx-orb-stage-sub' }, t('stage.workingSub')),
          revealed && h('div', { className: 'dsh-ctx-orb-stage-sub' },
            t('stage.transition', {
              before: String(Math.round(beforePercent)),
              after: String(Math.round(afterPercent)),
            })),
          revealed && base.freed !== undefined && base.freed !== null && base.freed > 0
            && h('div', { className: 'dsh-ctx-orb-stage-sub' }, t('stage.freed', { tokens: formatTokens(base.freed) })),
          failed && h('div', { className: 'dsh-ctx-orb-stage-sub' },
            t('error.' + String(base.failureKind === undefined || base.failureKind === null ? 'failed' : base.failureKind)))))
    }

    // ------------------------------------------------------------ the orb host

    /**
     * One session's orb. The registered entry remounts this component per
     * session id, so switching windows re-seeds the wave and can never carry a
     * running compression overlay into another session.
     */
    function OrbInner(props) {
      const t = props.t
      const useProjection = props.useProjection
      const useSession = props.useSession
      const runCompact = props.runCompact
      const report = props.report
      const anchorRef = useRef(null)
      const rootRef = useRef(null)
      const pressure = useProjection('contextPressure')
      const breakdown = useProjection('contextBreakdown')
      const running = useSession(function (snapshot) { return snapshot.running })
      const openState = useSession(function (snapshot) { return snapshot.openState })
      const occupancy = useMemo(function () { return occupancyOf(pressure) }, [pressure])
      const targetPercent = occupancy === null ? 0 : occupancy.percent
      const shownPercent = useAnimatedNumber(targetPercent, 560)
      const palette = useMemo(function () { return wavePalette(shownPercent) }, [shownPercent])
      const sessionId = props.sessionId
      // The composer anchor is the default home; once the user drags the orb,
      // the stored viewport point wins and travels across sessions and reloads.
      const anchorPosition = useAnchoredPosition(anchorRef)
      const [manualPosition, setManualPosition] = useState(readStoredOrbPosition)
      const manualPositionRef = useRef(manualPosition)
      manualPositionRef.current = manualPosition
      const position = manualPosition === null
        ? anchorPosition
        : clampOrbPosition(manualPosition.left, manualPosition.top)

      const [open, setOpen] = useState(false)
      const [phase, setPhase] = useState('idle')
      const [stageState, setStageState] = useState(null)
      const [notice, setNotice] = useState(null)
      const [dragging, setDragging] = useState(false)
      const clickTimerRef = useRef(0)
      const noticeTimerRef = useRef(0)
      const statusTimerRef = useRef(0)
      const dragRef = useRef(null)
      const suppressClickRef = useRef(false)
      const busyRef = useRef(false)
      const mountedRef = useRef(true)
      const occupancyRef = useRef(occupancy)
      occupancyRef.current = occupancy

      const closePanel = useCallback(function () { setOpen(false) }, [])
      useOutsideDismiss(open, closePanel, rootRef)

      useEffect(function () {
        mountedRef.current = true
        return function () {
          mountedRef.current = false
          if (clickTimerRef.current !== 0) {
            clearTimeout(clickTimerRef.current)
            clickTimerRef.current = 0
          }
          if (noticeTimerRef.current !== 0) {
            clearTimeout(noticeTimerRef.current)
            noticeTimerRef.current = 0
          }
          if (statusTimerRef.current !== 0) {
            clearTimeout(statusTimerRef.current)
            statusTimerRef.current = 0
          }
          // A session switch disposes this orb; nothing should keep reporting a
          // compaction into the next session's composer strip.
          publishCompactionState(sessionId, null)
        }
      }, [sessionId])

      // Keep a hand-placed orb on screen when the window shrinks.
      useEffect(function () {
        const onResize = function () {
          const current = manualPositionRef.current
          if (current === null) return
          const next = clampOrbPosition(current.left, current.top)
          if (next.left !== current.left || next.top !== current.top) setManualPosition(next)
        }
        window.addEventListener('resize', onResize)
        return function () { window.removeEventListener('resize', onResize) }
      }, [])

      const flashNotice = useCallback(function (text) {
        if (noticeTimerRef.current !== 0) clearTimeout(noticeTimerRef.current)
        setNotice(text)
        noticeTimerRef.current = setTimeout(function () {
          noticeTimerRef.current = 0
          if (mountedRef.current) setNotice(null)
        }, 2000)
      }, [])

      /**
       * Publish one compaction phase for the composer strip. Settled phases
       * hold for a few seconds so the result is readable, then the strip
       * dissolves; a working phase stays until the run reports again.
       * @param next - new status, or null to clear.
       */
      const publishStatus = useCallback(function (next) {
        if (statusTimerRef.current !== 0) {
          clearTimeout(statusTimerRef.current)
          statusTimerRef.current = 0
        }
        publishCompactionState(sessionId, next)
        if (next === null || next.phase === 'working') return
        const hold = next.phase === 'revealed' ? 6500 : 4500
        statusTimerRef.current = setTimeout(function () {
          statusTimerRef.current = 0
          if (mountedRef.current) publishCompactionState(sessionId, null)
        }, hold)
      }, [sessionId])

      const waitForCompacted = useCallback(function (beforeTokens) {
        return new Promise(function (resolve) {
          const started = performance.now()
          const check = function () {
            if (!mountedRef.current) {
              resolve(null)
              return
            }
            const latest = occupancyRef.current
            const improved = latest !== null && (beforeTokens === undefined || latest.usedTokens < beforeTokens - 1)
            if (improved) {
              resolve(latest)
              return
            }
            if (performance.now() - started > 5000) {
              resolve(latest)
              return
            }
            setTimeout(check, 140)
          }
          setTimeout(check, 80)
        })
      }, [])

      const finishStage = useCallback(function () {
        if (!mountedRef.current) return
        setPhase('idle')
        setStageState(null)
      }, [])

      /** Current orb point: the hand-placed one wins over the composer anchor. */
      const currentOrbPosition = function () {
        if (manualPositionRef.current !== null) {
          return clampOrbPosition(manualPositionRef.current.left, manualPositionRef.current.top)
        }
        return anchorPosition
      }

      const onOrbPointerDown = useCallback(function (event) {
        if (typeof event.button === 'number' && event.button !== 0) return
        if (busyRef.current || phase !== 'idle') return
        const base = currentOrbPosition()
        if (base === null) return
        suppressClickRef.current = false
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          left: base.left,
          top: base.top,
          moved: false,
        }
        if (typeof event.currentTarget.setPointerCapture === 'function') {
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch (error) {
            /* capture is a nicety; bubbling pointer events still follow the drag */
          }
        }
      }, [phase, anchorPosition])

      const onOrbPointerMove = useCallback(function (event) {
        const drag = dragRef.current
        if (drag === null || drag.pointerId !== event.pointerId) return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        if (!drag.moved) {
          drag.moved = true
          setDragging(true)
          setOpen(false)
        }
        if (event.cancelable) event.preventDefault()
        setManualPosition(clampOrbPosition(drag.left + dx, drag.top + dy))
      }, [])

      const onOrbPointerUp = useCallback(function (event) {
        const drag = dragRef.current
        if (drag === null || drag.pointerId !== event.pointerId) return
        dragRef.current = null
        if (typeof event.currentTarget.releasePointerCapture === 'function') {
          try {
            event.currentTarget.releasePointerCapture(event.pointerId)
          } catch (error) {
            /* already released */
          }
        }
        if (!drag.moved) return
        const finalPosition = clampOrbPosition(
          drag.left + event.clientX - drag.startX,
          drag.top + event.clientY - drag.startY,
        )
        suppressClickRef.current = true
        setDragging(false)
        setManualPosition(finalPosition)
        writeStoredOrbPosition(finalPosition)
      }, [])

      const onOrbPointerCancel = useCallback(function (event) {
        const drag = dragRef.current
        if (drag === null || drag.pointerId !== event.pointerId) return
        dragRef.current = null
        setDragging(false)
      }, [])

      /**
       * Keyboard placement: arrow keys nudge the orb and persist it, so a
       * hand-placed position is reachable without a pointer.
       */
      const onOrbKeyDown = useCallback(function (event) {
        const step = event.shiftKey ? 48 : 12
        let dx = 0
        let dy = 0
        if (event.key === 'Home') {
          event.preventDefault()
          clearStoredOrbPosition()
          setManualPosition(null)
          return
        }
        if (event.key === 'ArrowLeft') dx = -step
        else if (event.key === 'ArrowRight') dx = step
        else if (event.key === 'ArrowUp') dy = -step
        else if (event.key === 'ArrowDown') dy = step
        else return
        event.preventDefault()
        const base = currentOrbPosition()
        if (base === null) return
        const next = clampOrbPosition(base.left + dx, base.top + dy)
        setManualPosition(next)
        writeStoredOrbPosition(next)
      }, [anchorPosition])

      const startCompact = useCallback(function () {
        if (busyRef.current || phase !== 'idle') return
        const snapshot = occupancyRef.current
        if (snapshot === null) {
          flashNotice(t('notice.noUsage'))
          return
        }
        if (running) {
          flashNotice(t('notice.busy'))
          return
        }
        if (openState !== 'open') {
          flashNotice(t('notice.notReady'))
          return
        }
        busyRef.current = true
        setOpen(false)
        publishStatus({ phase: 'working' })
        setStageState({ before: snapshot, after: null, freed: undefined, failureKind: undefined })
        setPhase('working')
        const before = snapshot
        const run = async function () {
          try {
            const outcome = await runCompact()
            if (!outcome || outcome.ok !== true) {
              throw {
                reason: outcome && outcome.error && outcome.error.code === 'unavailable' ? 'unavailable' : 'transport',
                detail: outcome && outcome.error ? outcome.error.message : undefined,
              }
            }
            const execution = outcome.value
            if (execution === undefined || execution === null) throw { reason: 'unsupported' }
            const result = execution.result
            if (result === undefined || result === null || result.kind === 'error') {
              throw {
                reason: classifyCompactFailure(result === undefined || result === null ? undefined : result.text),
                detail: result === undefined || result === null ? undefined : result.text,
              }
            }
            const resultText = typeof result.text === 'string' ? result.text : ''
            // The Host reports an empty history as a successful no-op; replaying
            // the full success animation for it would promise a change that never
            // came, so it takes the short failure path instead.
            if (resultText.toLowerCase().indexOf('no compactable history') !== -1) {
              throw { reason: 'empty', detail: resultText }
            }
            const freedHint = parseFreedTokens(resultText)
            const measured = await waitForCompacted(before.usedTokens)
            if (!mountedRef.current) return
            const measuredFreed = measured === null ? 0 : Math.max(0, before.usedTokens - measured.usedTokens)
            const improved = measured !== null && measuredFreed > 1
            let after = improved ? measured : before
            let freed = improved ? measuredFreed : 0
            // The pressure projection can trail the command by a push interval;
            // when the Host named the shadowed tokens, show that reduction now.
            if (!improved && freedHint !== undefined && freedHint > 0) {
              const used = Math.max(0, before.usedTokens - freedHint)
              after = {
                percent: clamp(used / before.contextWindow * 100, 0, 100),
                usedTokens: used,
                contextWindow: before.contextWindow,
              }
              freed = freedHint
            }
            const settledFreed = freed > 0 ? freed : undefined
            setStageState({
              before: before,
              after: after,
              freed: settledFreed,
              failureKind: undefined,
            })
            publishStatus({
              phase: 'revealed',
              freed: settledFreed,
              beforePercent: before.percent,
              afterPercent: after.percent,
            })
            setPhase('revealed')
          } catch (failure) {
            if (!mountedRef.current) return
            const reason = failure !== null && typeof failure === 'object' && failure.reason ? failure.reason : 'failed'
            if (report !== undefined && (reason === 'failed' || reason === 'transport')) report(failure)
            setStageState({ before: before, after: null, freed: undefined, failureKind: reason })
            publishStatus({ phase: 'error', failureKind: reason })
            setPhase('error')
          } finally {
            busyRef.current = false
          }
        }
        void run()
      }, [phase, running, openState, runCompact, t, flashNotice, waitForCompacted, report, publishStatus])

      const onOrbClick = useCallback(function (event) {
        if (event !== undefined && event !== null) event.preventDefault()
        // The click that follows a drag is the tail of the gesture, not a
        // request for the panel.
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          return
        }
        if (phase !== 'idle' || busyRef.current) return
        if (notice !== null) setNotice(null)
        if (clickTimerRef.current !== 0) {
          clearTimeout(clickTimerRef.current)
          clickTimerRef.current = 0
          startCompact()
          return
        }
        clickTimerRef.current = setTimeout(function () {
          clickTimerRef.current = 0
          if (mountedRef.current) setOpen(function (value) { return !value })
        }, DOUBLE_PRESS_MS)
      }, [phase, notice, startCompact])

      const label = occupancy === null
        ? t('orb.loading')
        : t('orb.label', { percent: String(Math.round(occupancy.percent)) + '%' })
      const ariaLabel = occupancy === null
        ? t('orb.loading')
        : t('orb.aria', { percent: String(Math.round(occupancy.percent)) + '%' })
      const busy = phase !== 'idle'
      const stage = stageState === null ? null : h(CompressStage, {
        t: t,
        phase: phase,
        before: stageState.before,
        after: stageState.after,
        freed: stageState.freed,
        failureKind: stageState.failureKind,
        onFinished: finishStage,
      })
      const canUseDom = typeof document !== 'undefined' && document.body !== null
      return h(React.Fragment, null,
        h('span', { ref: anchorRef, className: 'dsh-ctx-orb-anchor', 'aria-hidden': 'true' }),
        position !== null && canUseDom && createPortal(
          h('div', {
            ref: rootRef,
            className: 'dsh-ctx-orb-portal',
            style: { left: position.left + 'px', top: position.top + 'px' },
            'data-busy': busy ? 'true' : 'false',
            'data-known': occupancy !== null ? 'true' : 'false',
          },
            notice !== null && h('span', {
              className: 'dsh-ctx-orb-notice',
              role: 'status',
              'data-side': position.left < 170 ? 'right' : 'left',
            }, notice),
            open && !busy && h(OrbPanel, {
              t: t,
              occupancy: occupancy,
              breakdown: breakdown,
              palette: palette,
              running: running,
              flip: position.top < 300,
              onCompact: startCompact,
            }),
            h(OrbGlyph, {
              label: label,
              aria: ariaLabel,
              percent: shownPercent,
              known: occupancy !== null,
              palette: palette,
              expanded: open,
              dragging: dragging,
              onPointerDown: onOrbPointerDown,
              onPointerMove: onOrbPointerMove,
              onPointerUp: onOrbPointerUp,
              onPointerCancel: onOrbPointerCancel,
              onKeyDown: onOrbKeyDown,
              onClick: onOrbClick,
            })),
          document.body),
        stage !== null && canUseDom && createPortal(stage, document.body))
    }

    /**
     * Registered entry: one keyed orb host per session id, so a session switch
     * is a real remount (fresh wave seed, fresh state) rather than a prop swap.
     */
    function ContextOrbEntry(props) {
      return h(OrbInner, {
        key: String(props.sessionId),
        sessionId: props.sessionId,
        t: props.t,
        useProjection: props.useProjection,
        useSession: props.useSession,
        runCompact: props.runCompact,
        report: props.report,
      })
    }

    /**
     * Run the Host's own /compact command against one session through the
     * Commands Remote namespace the command surface uses.
     * @param ctx - owning client plugin context.
     * @param sessionId - session the orb belongs to.
     * @returns the RemoteResult the command surface returns.
     */
    async function runCompactCommand(ctx, sessionId) {
      let commands
      try {
        commands = typeof ctx.get === 'function' ? ctx.get('remote.commands') : undefined
      } catch (error) {
        commands = undefined
      }
      if ((commands === undefined || commands === null) && ctx.remote !== undefined && ctx.remote !== null) {
        commands = ctx.remote.commands
      }
      if (commands === undefined || commands === null || typeof commands.execute !== 'function') {
        return { ok: false, error: { code: 'unavailable', message: 'the commands Remote namespace is not mounted' } }
      }
      return commands.execute(sessionId, '/compact', [])
    }

    return {
      name: 'context-orb',
      inject: ['slots', 'locale', 'remote'],
      /**
       * Register the dictionaries, the style sheet, and the composer overlay
       * entry. Every registration rides the caller's fiber effect, so unloading
       * the plugin removes the orb with it.
       * @param ctx - client root context.
       */
      apply(ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, { en: en, zh: zh })
        }, 'context-orb: dictionaries')
        if (typeof document !== 'undefined') {
          ctx.effect(function () {
            const stale = document.querySelectorAll('style[' + STYLE_ATTR + ']')
            for (let index = 0; index < stale.length; index += 1) stale[index].remove()
            const style = document.createElement('style')
            style.setAttribute(STYLE_ATTR, '')
            style.textContent = CSS
            document.head.appendChild(style)
            return function () { style.remove() }
          }, 'context-orb: styles')
        }
        ctx.effect(function () {
          return ctx.slots.inject('conversation.input.overlay', function () {
            return ctx.slots.register({
              name: 'conversation.input.overlay',
              id: 'context-orb',
              order: 40,
              locale: NS,
              inject: function (sessionId) {
                return {
                  runCompact: function () { return runCompactCommand(ctx, sessionId) },
                  report: function (failure) {
                    if (ctx.logger !== undefined && ctx.logger !== null && typeof ctx.logger.warn === 'function') {
                      const message = failure instanceof Error
                        ? failure.message
                        : (failure !== null && typeof failure === 'object' && failure.detail) || 'unknown failure'
                      ctx.logger.warn('context-orb: compaction did not run: %s', message)
                    }
                  },
                }
              },
            }, ContextOrbEntry)
          })
        }, 'context-orb: composer overlay')
        ctx.effect(function () {
          return ctx.slots.inject('conversation.input.dock', function () {
            return ctx.slots.register({
              name: 'conversation.input.dock',
              id: 'context-orb-compaction',
              order: 15,
              locale: NS,
              inject: function (sessionId) {
                return { sessionId: sessionId }
              },
            }, CompactionDock)
          })
        }, 'context-orb: compaction status strip')
      },
    }
  },
})
