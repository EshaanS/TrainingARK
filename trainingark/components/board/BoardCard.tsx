'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { createPortal } from 'react-dom'
import type { Card, TriggerTag } from '@/types/board'
import { CardContextMenu, type ZoneTarget, type StackType } from './CardContextMenu'
import { EVENT_TYPE_LABELS } from '@/lib/triggerDetection'
import styles from './BoardCard.module.css'
import type { EditableZone } from '@/store/builderStore'

interface BoardCardProps {
  card: Card
  onMove?: (target: ZoneTarget) => void
  onCastToStack?: (type: StackType) => void
  onRemove?: () => void
  onCreateTokenCopy?: () => void
  onToggleTapped?: () => void
  // Only passed for opponent seats; its absence is what hides the reveal
  // toggle on the player's own cards.
  onToggleRevealed?: () => void
  onToggleDoesNotUntap?: () => void
  onSetTriggerTag?: (tag?: TriggerTag) => void
  onIncrement?: () => void
  onDecrement?: () => void
  currentZone: EditableZone
  compact?: boolean
  showRemoveX?: boolean
  // readOnly: render-only mode for the scenario viewer. Keeps hover preview,
  // tapped rotation, and the token badge. Drops menus, shortcuts, and buttons.
  readOnly?: boolean
}

const CARD_BACK = '/back_magic.png'

export function BoardCard({
  card, onMove, onCastToStack, onRemove, onCreateTokenCopy,
  onToggleTapped, onToggleRevealed, onToggleDoesNotUntap, onSetTriggerTag,
  onIncrement, onDecrement,
  currentZone, compact, showRemoveX, readOnly,
}: BoardCardProps) {
  const [hovered, setHovered] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const src = card.imageUrl ?? CARD_BACK
  const isToken = card.isToken ?? false
  const stackCount = card.stackCount ?? 1

  function openContextMenu(x: number, y: number) {
    if (readOnly) return
    setContextMenu({ x, y })
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    openContextMenu(e.clientX, e.clientY)
  }

  function handleDotsClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const rect = cardRef.current?.getBoundingClientRect()
    if (rect) openContextMenu(rect.left, rect.top + 24)
  }

  useEffect(() => {
    if (readOnly || compact || !hovered) return
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      switch (e.key.toLowerCase()) {
        case 'b': if (currentZone !== 'battlefield') onMove?.('battlefield'); break
        case 'h': if (currentZone !== 'hand') onMove?.('hand'); break
        case 'g': if (currentZone !== 'graveyard') onMove?.('graveyard'); break
        case 'e': if (currentZone !== 'exile') onMove?.('exile'); break
        case 'l': if (currentZone !== 'library') onMove?.('library-top'); break
        case 't': if (currentZone === 'battlefield') onToggleTapped?.(); break
        // Opponent-only: onToggleRevealed is undefined on the player's own cards.
        case 'r': onToggleRevealed?.(); break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [hovered, onMove, onToggleTapped, onToggleRevealed, currentZone, compact, readOnly])

  const contextMenuEl = !readOnly && contextMenu && (
    <CardContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      cardName={card.name}
      cardType={card.cardType}
      isCommander={card.isCommander}
      isTapped={card.tapped}
      isRevealed={card.revealed}
      isDoesNotUntap={card.doesNotUntap}
      triggerTag={card.triggerTag}
      onMove={t => onMove?.(t)}
      onCastToStack={t => onCastToStack?.(t)}
      onToggleTapped={onToggleTapped}
      onToggleRevealed={onToggleRevealed}
      onToggleDoesNotUntap={onToggleDoesNotUntap}
      onSetTriggerTag={onSetTriggerTag}
      onRemove={() => onRemove?.()}
      onCreateTokenCopy={onCreateTokenCopy}
      onClose={() => setContextMenu(null)}
      currentZone={currentZone}
    />
  )

  if (compact) {
    if (readOnly) return null
    return (
      <>
        <div ref={cardRef} className={styles.compactWrap}>
          <button className={styles.compactDotsBtn} onClick={handleDotsClick} title="Card actions">
            &#8942;
          </button>
        </div>
        {contextMenuEl}
      </>
    )
  }

  return (
    <>
      <div
        ref={cardRef}
        className={`${styles.card} ${card.tapped ? styles.tapped : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={handleContextMenu}
      >
        <Image
          src={src}
          alt={card.name}
          width={80}
          height={112}
          style={{ borderRadius: 4, display: 'block', width: '100%', height: '100%' }}
        />

        {!readOnly && hovered && (
          <button className={styles.dotsBtn} onClick={handleDotsClick}>
            &#8942;
          </button>
        )}

        {!readOnly && hovered && showRemoveX && onRemove && (
          <button
            className={styles.removeBtn}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onRemove() }}
            title={isToken ? 'Remove all tokens' : 'Remove from game'}
          >
            ×
          </button>
        )}

        {isToken && stackCount > 1 && (
          <div className={styles.stackBadge}>×{stackCount}</div>
        )}

        {/* Authoring-only marker: every hand is face-up in the builder, so this
            is the only way to see that a card is flagged for the viewer. Hidden
            while hovered so it never sits under the ⋮ / × buttons. */}
        {!readOnly && card.revealed && !hovered && (
          <div className={styles.revealBadge} title="Revealed to viewer">◉</div>
        )}

        {!readOnly && !hovered && card.doesNotUntap && currentZone === 'battlefield' && (
          <div className={styles.doesNotUntapBadge} title="Does not untap">⊘</div>
        )}

        {!readOnly && !hovered && card.triggerTag && !isToken && (
          <div className={styles.triggerTagBadge} title={EVENT_TYPE_LABELS[card.triggerTag.event]}>⟳</div>
        )}

        {!readOnly && hovered && isToken && (onIncrement || onDecrement) && (
          <div className={styles.tokenControls}>
            <button
              className={styles.tokenBtn}
              onClick={e => { e.preventDefault(); e.stopPropagation(); onDecrement?.() }}
              title="Remove one"
            >
              −
            </button>
            <button
              className={styles.tokenBtn}
              onClick={e => { e.preventDefault(); e.stopPropagation(); onIncrement?.() }}
              title="Add one"
            >
              +
            </button>
          </div>
        )}

        {hovered && card.imageUrl && createPortal(
          <div className={styles.preview}>
            <Image
              src={card.imageUrl}
              alt={card.name}
              width={240}
              height={336}
              style={{ borderRadius: 8, display: 'block' }}
            />
          </div>,
          document.body
        )}
      </div>

      {contextMenuEl}
    </>
  )
}
