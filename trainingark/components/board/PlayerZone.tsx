'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import type { Player, PlayerPosition, Card } from '@/types/board'
import styles from './PlayerZone.module.css'
import { BoardCard } from './BoardCard'
import type { ZoneTarget, StackType } from './CardContextMenu'
import { ZoneMenu, type ZoneMenuItem } from './ZoneMenu'
import { CommanderSetupModal } from './CommanderSetupModal'
import { useBuilderStore, makeUnknownCard, type EditableZone } from '@/store/builderStore'
import { detectCardMetadata } from '@/lib/triggerDetection'

interface PlayerZoneProps {
  playerIndex: number
  position: PlayerPosition
  revealAll?: boolean
  viewMode?: boolean
  playerOverride?: Player
}

const CARD_BACK = '/back_magic.png'
const CARD_W = 80
const CARD_H = 112

type ExpandableZone = 'hand' | 'graveyard' | 'exile' | 'library'

function formatTax(tax: Player['commanderTax']): string {
  if (Array.isArray(tax)) return `Tax: ${tax[0]} / ${tax[1]}`
  return `Tax: ${tax}`
}

const PLAYER_NAMES = ['Player', 'Opponent 1', 'Opponent 2', 'Opponent 3']

const ZONE_TARGET_MAP: Record<ZoneTarget, EditableZone> = {
  battlefield: 'battlefield',
  hand: 'hand',
  graveyard: 'graveyard',
  exile: 'exile',
  'library-top': 'library',
  'library-bottom': 'library',
  command: 'command',
}

function parseCardType(typeLine: string): Card['cardType'] {
  if (typeLine.includes('Creature')) return 'creature'
  if (typeLine.includes('Land')) return 'land'
  if (typeLine.includes('Planeswalker')) return 'planeswalker'
  if (typeLine.includes('Artifact')) return 'artifact'
  if (typeLine.includes('Enchantment')) return 'enchantment'
  if (typeLine.includes('Instant')) return 'instant'
  if (typeLine.includes('Sorcery')) return 'sorcery'
  if (typeLine.includes('Battle')) return 'battle'
  return 'artifact'
}

export function cleanDecklistLine(rawLine: string): string {
  let line = rawLine.trim()
  line = line.replace(/^\d+\s+/, '')
  line = line.replace(/\s+\([A-Za-z0-9]{2,6}\).*$/, '')
  return line.trim()
}

async function fetchDecklistCards(lines: string[]): Promise<Card[]> {
  const results: Card[] = []
  for (let i = 0; i < lines.length; i += 75) {
    const batch = lines.slice(i, i + 75).filter(Boolean)
    try {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map(name => ({ name })) }),
      })
      if (!res.ok) continue
      const data = await res.json()
      for (const card of (data.data ?? [])) {
        const oracleText = card.oracle_text ?? card.card_faces?.[0]?.oracle_text
        const keywords = card.keywords ?? card.card_faces?.[0]?.keywords
        results.push({
          id: card.id,
          name: card.name,
          imageUrl: card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal,
          cardType: parseCardType(card.type_line ?? ''),
          ...detectCardMetadata(oracleText, keywords),
        })
      }
    } catch { /* skip failed batch */ }
  }
  return results
}

export function PlayerZone({ playerIndex, position, revealAll, viewMode, playerOverride }: PlayerZoneProps) {
  const {
    players, updatePlayer, confirmSetup, setupComplete,
    moveCard, moveAllCards, addCard, castToStack, setLife, setTax, setTaxPartner,
    decklists, drawCard, shuffleLibrary, removeCard, createTokenCopy,
    incrementToken, decrementToken, toggleTapped, toggleRevealed,
    toggleDoesNotUntap, setTriggerTag,
    handSizes, setHandSize,
    turnCounters, setSpellsCastThisTurn, setCardsDrawnThisTurn,
    isDuplicate, dismissDuplicateWarning, dismissedDuplicateWarnings,
    populateLibrary,
  } = useBuilderStore()

  const player = viewMode ? playerOverride : players?.[playerIndex]
  const isSetupDone = setupComplete[playerIndex]
  const decklist = decklists[playerIndex] ?? []
  const isPlayerSeat = playerIndex === 0

  const [expanded, setExpanded] = useState<ExpandableZone | null>(null)
  const [filterText, setFilterText] = useState('')
  const [showCardSearch, setShowCardSearch] = useState<{ zone: EditableZone; tokensOnly?: boolean } | null>(null)
  const [cardSearchRect, setCardSearchRect] = useState<DOMRect | null>(null)
  const [editingLife, setEditingLife] = useState(false)
  const [lifeInput, setLifeInput] = useState('')
  const [editingTax, setEditingTax] = useState<0 | 1 | null>(null)
  const [taxInput, setTaxInput] = useState('')
  const [editingHandSize, setEditingHandSize] = useState(false)
  const [handSizeInput, setHandSizeInput] = useState('')
  const [editingSpellsCast, setEditingSpellsCast] = useState(false)
  const [spellsCastInput, setSpellsCastInput] = useState('')
  const [editingCardsDrawn, setEditingCardsDrawn] = useState(false)
  const [cardsDrawnInput, setCardsDrawnInput] = useState('')
  const [zoneMenu, setZoneMenu] = useState<{ x: number; y: number; items: ZoneMenuItem[] } | null>(null)
  const [editPoolLoading, setEditPoolLoading] = useState(false)
  const [showEditPool, setShowEditPool] = useState(false)
  const [editPoolText, setEditPoolText] = useState('')
  const [showLibraryOrder, setShowLibraryOrder] = useState(false)
  const [pendingLibraryCards, setPendingLibraryCards] = useState<Card[]>([])
  const [pendingLibraryTarget, setPendingLibraryTarget] = useState(99)
  const [fetchingCards, setFetchingCards] = useState(false)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const handAddBtnRef = useRef<HTMLButtonElement>(null)
  const graveyardAddBtnRef = useRef<HTMLButtonElement>(null)
  const exileAddBtnRef = useRef<HTMLButtonElement>(null)
  const libraryAddBtnRef = useRef<HTMLButtonElement>(null)
  const handFanRef = useRef<HTMLDivElement>(null)
  const [fanWidth, setFanWidth] = useState(200)
  const [cardW, setCardW] = useState(80)

  useEffect(() => {
    const el = handFanRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      setFanWidth(entries[0].contentRect.width)
      const v = getComputedStyle(el).getPropertyValue('--card-w')
      const px = parseFloat(v)
      if (!isNaN(px) && px > 0) setCardW(px)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const isTop = position === 'top-left' || position === 'top-right'
  const isRight = position === 'top-right' || position === 'bottom-right'

  function toggle(zone: ExpandableZone) {
    setFilterText('')
    setExpanded(prev => prev === zone ? null : zone)
  }

  function zoneCount(zoneName: keyof Player['zones']): number {
    if (!player) return 0
    const zone = player.zones[zoneName]
    return zone.cardCount ?? zone.cards.length
  }

  function handleMove(cardId: string, target: ZoneTarget) {
    if (viewMode || !player) return
    const toZone = ZONE_TARGET_MAP[target]
    const positionArg = target === 'library-bottom' ? 'bottom' : 'top'
    for (const [zoneName, zone] of Object.entries(player.zones)) {
      if (zone.cards.find((c: Card) => c.id === cardId)) {
        moveCard(playerIndex, cardId, zoneName as EditableZone, toZone, positionArg)
        return
      }
    }
  }

  function handleCastToStack(cardId: string, type: StackType) {
    if (viewMode || !player) return
    for (const [zoneName, zone] of Object.entries(player.zones)) {
      if (zone.cards.find((c: Card) => c.id === cardId)) {
        castToStack(playerIndex, cardId, zoneName as EditableZone, type)
        return
      }
    }
  }

  function handleRemove(cardId: string) {
    if (viewMode) return
    removeCard(playerIndex, cardId)
  }

  function handleTokenCopy(cardId: string) {
    if (viewMode) return
    createTokenCopy(playerIndex, cardId)
  }

  // Per-card reveal is an opponent-seat authoring tool. Returning undefined for
  // the player's own seat (and in the viewer) is what keeps the context-menu
  // item and the R shortcut off those cards.
  function revealHandler(cardId: string): (() => void) | undefined {
    if (viewMode || isPlayerSeat) return undefined
    return () => toggleRevealed(playerIndex, cardId)
  }

  function handleAddCard(zone: EditableZone, rect: DOMRect, tokensOnly?: boolean) {
    if (viewMode) return
    setShowCardSearch({ zone, tokensOnly })
    setCardSearchRect(rect)
  }

  function handleCardSelected(card: Card) {
    if (viewMode || !showCardSearch) return
    const { zone } = showCardSearch
    if (decklist.length > 0 && !decklist.includes(card.name) && !card.isToken) return
    addCard(playerIndex, zone, card)
    setShowCardSearch(null)
    setCardSearchRect(null)
  }

  function handleSetupConfirm(partial: Partial<Player>, _commanderNames: string[], dl: string[]) {
    if (viewMode || !player) return
    const cleanedDl = dl.map(cleanDecklistLine).filter(Boolean)
    const updated: Player = {
      ...(player as Player),
      ...partial,
      zones: { ...(player as Player).zones, ...(partial.zones ?? {}) },
      commanderTax: partial.commanderTax ?? 0,
    }
    updatePlayer(playerIndex, updated)
    confirmSetup(playerIndex, cleanedDl)

    if (cleanedDl.length > 0) {
      const targetCount = partial.zones?.library?.cardCount ?? 99
      setFetchingCards(true)
      fetchDecklistCards(cleanedDl)
        .then(cards => {
          setPendingLibraryCards(cards)
          setPendingLibraryTarget(targetCount)
          setShowLibraryOrder(true)
        })
        .finally(() => setFetchingCards(false))
    }
  }

  function commitLife() {
    const val = parseInt(lifeInput)
    if (!isNaN(val)) setLife(playerIndex, val)
    setEditingLife(false)
  }

  function commitTax() {
    if (!player) return
    const val = parseInt(taxInput)
    if (isNaN(val) || editingTax === null) { setEditingTax(null); return }
    if (Array.isArray(player.commanderTax)) {
      setTaxPartner(playerIndex, editingTax, val)
    } else {
      setTax(playerIndex, val)
    }
    setEditingTax(null)
  }

  function commitSpellsCast() {
    const val = parseInt(spellsCastInput)
    if (!isNaN(val)) setSpellsCastThisTurn(playerIndex, val)
    setEditingSpellsCast(false)
  }

  function commitCardsDrawn() {
    const val = parseInt(cardsDrawnInput)
    if (!isNaN(val)) setCardsDrawnThisTurn(playerIndex, val)
    setEditingCardsDrawn(false)
  }

  function commitHandSize() {
    const val = parseInt(handSizeInput)
    if (!isNaN(val) && val > 0) setHandSize(playerIndex, val)
    setEditingHandSize(false)
  }

  function moveAllFromZone(fromZone: EditableZone, toZone: EditableZone, positionArg: 'top' | 'bottom' = 'top') {
    if (viewMode || !player) return
    moveAllCards(playerIndex, fromZone, toZone, positionArg)
  }

  function discardRandom() {
    if (viewMode || !player) return
    const cards = player.zones.hand.cards
    if (cards.length === 0) return
    const card = cards[Math.floor(Math.random() * cards.length)]
    moveCard(playerIndex, card.id, 'hand', 'graveyard')
  }

  function handleEditPoolConfirm() {
    if (viewMode || !player) return
    const lines = editPoolText.split('\n').map(cleanDecklistLine).filter(Boolean)
    setEditPoolLoading(true)
    fetchDecklistCards(lines)
      .then(cards => {
        confirmSetup(playerIndex, lines)
        setPendingLibraryCards(cards)
        setPendingLibraryTarget(player.zones.library.cardCount ?? 99)
        setShowLibraryOrder(true)
        setShowEditPool(false)
      })
      .finally(() => setEditPoolLoading(false))
  }

  function handleLibraryOrderConfirm(orderedCards: Card[]) {
    if (viewMode) return
    populateLibrary(playerIndex, orderedCards)
    setShowLibraryOrder(false)
  }

  function openZoneMenu(e: React.MouseEvent, items: ZoneMenuItem[]) {
    e.stopPropagation()
    setZoneMenu({ x: e.clientX, y: e.clientY, items })
  }

  function openOuterMenu(e: React.MouseEvent) {
    if (viewMode) return
    e.stopPropagation()
    const items: ZoneMenuItem[] = [
      { label: 'Search Library', action: () => toggle('library') },
      { label: 'Shuffle Library', action: () => shuffleLibrary(playerIndex) },
      { label: 'Draw', action: () => drawCard(playerIndex) },
      {
        label: 'Add Token', action: () => {
          const rect = addBtnRef.current?.getBoundingClientRect()
          if (rect) handleAddCard('battlefield', rect, true)
        },
      },
      {
        label: 'Edit card pool', action: () => {
          setEditPoolText(decklist.join('\n'))
          setShowEditPool(true)
        },
      },
      {
        label: 'Set library order', action: () => {
          if (!player) return
          const realCards = player.zones.library.cards.filter(c => !c.faceDown)
          setPendingLibraryCards(realCards)
          setPendingLibraryTarget(player.zones.library.cardCount ?? 99)
          setShowLibraryOrder(true)
        },
      },
    ]
    setZoneMenu({ x: e.clientX, y: e.clientY, items })
  }

  if (!player) return null
  const p: Player = player

  const handCount = zoneCount('hand')
  const handRevealed = viewMode
    ? (isPlayerSeat || p.zones.hand.revealed)
    : (revealAll || p.zones.hand.revealed)
  const handCards = p.zones.hand.cards

  function renderHand() {
    const showAllFaces = handRevealed && handCards.length > 0
    // A hidden hand can still contain individually revealed cards. Those are
    // drawn face-up at the front of the fan and the rest of the slots stay
    // card backs, so the hand keeps its real size either way.
    const revealedCards = showAllFaces ? [] : handCards.filter((c: Card) => c.revealed)
    const count = showAllFaces
      ? handCards.length
      : Math.max(handCount, revealedCards.length)
    const maxOverlap = cardW * 0.45
    const dynamicOverlap = count <= 1
      ? 0
      : Math.min(maxOverlap, (fanWidth - cardW) / (count - 1))

    return (
      <div
        ref={handFanRef}
        className={styles.handFan}
        onClick={() => { if (!viewMode || handRevealed) toggle('hand') }}
      >
        {showAllFaces
          ? handCards.map((card: Card, i: number) => (
              <div key={card.id} className={styles.fanCard} style={{ left: i * dynamicOverlap }} onClick={e => { if (!viewMode) e.stopPropagation() }}>
                <BoardCard
                  card={card}
                  onMove={t => handleMove(card.id, t)}
                  onCastToStack={t => handleCastToStack(card.id, t)}
                  onRemove={() => handleRemove(card.id)}
                  onToggleRevealed={revealHandler(card.id)}
                  showRemoveX
                  currentZone="hand"
                  readOnly={viewMode}
                />
              </div>
            ))
          : Array.from({ length: count }).map((_, i: number) => {
              const card = revealedCards[i]
              if (!card) {
                return (
                  <div key={`back-${i}`} className={styles.fanCard} style={{ left: i * dynamicOverlap }}>
                    <Image src={CARD_BACK} alt="Card back" width={80} height={112} style={{ borderRadius: 4, display: 'block', width: 'var(--card-w)', height: 'var(--card-h)' }} />
                  </div>
                )
              }
              return (
                <div key={card.id} className={styles.fanCard} style={{ left: i * dynamicOverlap }} onClick={e => { if (!viewMode) e.stopPropagation() }}>
                  <BoardCard
                    card={card}
                    onMove={t => handleMove(card.id, t)}
                    onCastToStack={t => handleCastToStack(card.id, t)}
                    onRemove={() => handleRemove(card.id)}
                    onToggleRevealed={revealHandler(card.id)}
                    showRemoveX
                    currentZone="hand"
                    readOnly={viewMode}
                  />
                </div>
              )
            })
        }
      </div>
    )
  }

  // Piles (graveyard/exile) always show a single top card, so they are
  // always exactly one card in size — no cards.length-based width here.
  function renderPile(cards: Card[], count: number, revealed: boolean, zone: EditableZone) {
    if (count === 0) return <div className={styles.emptyPile} style={{ width: 'var(--card-w)', height: 'var(--card-h)' }} />
    const topCard = cards[cards.length - 1]
    if (!topCard) {
      return (
        <div style={{ width: 'var(--card-w)', height: 'var(--card-h)' }}>
          <Image src={CARD_BACK} alt="top card" width={CARD_W} height={CARD_H} style={{ borderRadius: 4, display: 'block', width: 'var(--card-w)', height: 'var(--card-h)' }} />
        </div>
      )
    }
    return (
      <div onClick={e => { if (!viewMode) e.stopPropagation() }}>
        <BoardCard
          card={revealed ? topCard : { ...topCard, imageUrl: undefined }}
          onMove={t => handleMove(topCard.id, t)}
          onCastToStack={t => handleCastToStack(topCard.id, t)}
          onRemove={() => handleRemove(topCard.id)}
          onToggleRevealed={revealHandler(topCard.id)}
          showRemoveX
          currentZone={zone}
          readOnly={viewMode}
        />
      </div>
    )
  }

  // Command zone: one card width normally, widens only for two commanders (partners).
  function renderCommandZone() {
    const cards = p.zones.command.cards
    if (cards.length === 0) return <div className={styles.emptyPile} style={{ width: 'var(--card-w)', height: 'var(--card-h)' }} />
    const wide = cards.length > 1
    return (
      <div className={styles.commandWrap} style={{ width: wide ? 'calc(var(--card-w) + 16px)' : 'var(--card-w)' }}>
        {cards.map((card: Card, i: number) => (
          <div key={card.id} className={styles.commandCardSlot} style={{ left: i * 16, zIndex: i }}>
            <BoardCard
              card={card}
              onMove={t => handleMove(card.id, t)}
              onCastToStack={t => handleCastToStack(card.id, t)}
              onToggleRevealed={revealHandler(card.id)}
              currentZone="command"
              readOnly={viewMode}
            />
          </div>
        ))}
      </div>
    )
  }

  function zoneHeader(
    label: string,
    count: number | null,
    expandKey: ExpandableZone | null,
    menuItems: ZoneMenuItem[],
    addRef?: React.RefObject<HTMLButtonElement | null>,
    onAdd?: () => void,
  ) {
    const clickable = expandKey !== null && (!viewMode || expandKey !== 'library')
    return (
      <div className={styles.zoneLabelRow}>
        <span
          className={styles.zoneLabelText}
          style={{ cursor: clickable ? 'pointer' : 'default' }}
          onClick={() => clickable && expandKey && toggle(expandKey)}
          title={`${label}${count !== null ? ` (${count})` : ''}`}
        >
          {label}{count !== null ? ` (${count})` : ''}
        </span>
        {!viewMode && onAdd && (
          <button ref={addRef} className={styles.zoneAddBtn} onClick={e => { e.stopPropagation(); onAdd() }} title={`Add card to ${label}`}>+</button>
        )}
        {!viewMode && menuItems.length > 0 && (
          <button className={styles.zoneArrow} onClick={e => openZoneMenu(e, menuItems)}>▼</button>
        )}
      </div>
    )
  }

  const libCount = zoneCount('library')
  const commandWide = p.zones.command.cards.length > 1

  const handSection = (
    <div className={styles.zoneSection} style={{ flex: 1, minWidth: 'max-content' }}>
      {zoneHeader('Hand', handCount, viewMode && !handRevealed ? null : 'hand', [
        { label: 'Move all to Library', action: () => moveAllFromZone('hand', 'library') },
        { label: 'Move all to Bottom of Library', action: () => moveAllFromZone('hand', 'library', 'bottom') },
        { label: 'Move all to Graveyard', action: () => moveAllFromZone('hand', 'graveyard') },
        { label: 'Move all to Exile', action: () => moveAllFromZone('hand', 'exile') },
        { label: 'Discard a Card Randomly', action: discardRandom, danger: true },
      ], handAddBtnRef, () => { const r = handAddBtnRef.current?.getBoundingClientRect(); if (r) handleAddCard('hand', r) })}
      {renderHand()}
    </div>
  )

  const librarySection = (
    <div className={styles.zoneSection}>
      {zoneHeader('Lib', libCount, viewMode ? null : 'library', [
        { label: 'View Top Card', action: () => toggle('library') },
        { label: 'Move all to Hand', action: () => moveAllFromZone('library', 'hand') },
        { label: 'Move all to Graveyard', action: () => moveAllFromZone('library', 'graveyard') },
        { label: 'Move all to Exile', action: () => moveAllFromZone('library', 'exile') },
        { label: 'Shuffle', action: () => shuffleLibrary(playerIndex) },
      ], libraryAddBtnRef, () => { const r = libraryAddBtnRef.current?.getBoundingClientRect(); if (r) handleAddCard('library', r) })}
      {fetchingCards && !viewMode ? (
        <div className={styles.emptyPile} style={{ width: 'var(--card-w)', height: 'var(--card-h)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '0.58rem', color: 'rgba(232,224,212,0.4)' }}>Loading...</span>
        </div>
      ) : (
        <div
          style={{ cursor: !viewMode && libCount > 0 ? 'pointer' : 'default' }}
          onClick={() => { if (!viewMode && libCount > 0) drawCard(playerIndex) }}
          title={!viewMode && libCount > 0 ? 'Click to draw' : ''}
        >
          {libCount > 0
            ? <Image src={CARD_BACK} alt="Library" width={CARD_W} height={CARD_H} style={{ borderRadius: 4, display: 'block', width: 'var(--card-w)', height: 'var(--card-h)' }} />
            : <div className={styles.emptyPile} style={{ width: 'var(--card-w)', height: 'var(--card-h)' }} />
          }
        </div>
      )}
    </div>
  )

  const graveyardSection = (
    <div className={styles.zoneSection}>
      {zoneHeader('GY', zoneCount('graveyard'), 'graveyard', [
        { label: 'View all', action: () => toggle('graveyard') },
        { label: 'Move all to Hand', action: () => moveAllFromZone('graveyard', 'hand') },
        { label: 'Move all to Library', action: () => moveAllFromZone('graveyard', 'library') },
        { label: 'Move all to Bottom of Library', action: () => moveAllFromZone('graveyard', 'library', 'bottom') },
        { label: 'Move all to Exile', action: () => moveAllFromZone('graveyard', 'exile') },
      ], graveyardAddBtnRef, () => { const r = graveyardAddBtnRef.current?.getBoundingClientRect(); if (r) handleAddCard('graveyard', r) })}
      {renderPile(p.zones.graveyard.cards, zoneCount('graveyard'), true, 'graveyard')}
    </div>
  )

  const exileSection = (
    <div className={styles.zoneSection}>
      {zoneHeader('Ex', zoneCount('exile'), 'exile', [
        { label: 'View all', action: () => toggle('exile') },
        { label: 'Move all to Hand', action: () => moveAllFromZone('exile', 'hand') },
        { label: 'Move all to Graveyard', action: () => moveAllFromZone('exile', 'graveyard') },
        { label: 'Move all to Library', action: () => moveAllFromZone('exile', 'library') },
        { label: 'Move all to Bottom of Library', action: () => moveAllFromZone('exile', 'library', 'bottom') },
      ], exileAddBtnRef, () => { const r = exileAddBtnRef.current?.getBoundingClientRect(); if (r) handleAddCard('exile', r) })}
      {renderPile(p.zones.exile.cards, zoneCount('exile'), true, 'exile')}
    </div>
  )

  const commandSection = (
    <div className={styles.zoneSection} style={commandWide ? { minWidth: 'calc(var(--card-w) + 16px)' } : undefined}>
      <div className={styles.zoneLabelRow}>
        <span className={styles.zoneLabelText} style={{ cursor: 'default' }}>
          Command
        </span>
      </div>
      {renderCommandZone()}
    </div>
  )

  const div = <div className={styles.stripDivider} />

  const rightSideZones = (
    <>
      {handSection}{div}
      {librarySection}{div}
      {graveyardSection}{div}
      {exileSection}{div}
      {commandSection}
    </>
  )

  const leftSideZones = (
    <>
      {commandSection}{div}
      {exileSection}{div}
      {graveyardSection}{div}
      {librarySection}{div}
      {handSection}
    </>
  )

  const expandedCardsRaw = (() => {
    if (!expanded) return []
    if (expanded === 'hand') return handRevealed ? handCards : []
    return p.zones[expanded].cards
  })()

  const expandedCards = filterText
    ? expandedCardsRaw.filter(c => c.name.toLowerCase().includes(filterText.toLowerCase()))
    : expandedCardsRaw

  const expandedPanel = expanded && (
    <div className={styles.expandedPanel}>
      <div className={styles.expandedHeader}>
        <span>Viewing {expanded[0].toUpperCase() + expanded.slice(1)}</span>
        <button className={styles.closeExpanded} onClick={() => setExpanded(null)}>×</button>
      </div>
      <div className={styles.expandedList}>
        {expandedCards.length === 0 && (
          <p className={styles.emptyZoneText}>No cards here.</p>
        )}
        {[...expandedCards].reverse().map(card => (
          <ExpandedRow
            key={card.id}
            card={card}
            readOnly={viewMode}
            onMove={t => handleMove(card.id, t)}
            onCastToStack={t => handleCastToStack(card.id, t)}
            onRemove={() => handleRemove(card.id)}
            onCreateTokenCopy={() => handleTokenCopy(card.id)}
            onIncrement={card.isToken ? () => incrementToken(playerIndex, card.id) : undefined}
            onDecrement={card.isToken ? () => decrementToken(playerIndex, card.id) : undefined}
            currentZone={expanded}
          />
        ))}
      </div>
      <input
        className={styles.expandedFilter}
        placeholder="Filter..."
        value={filterText}
        onChange={e => setFilterText(e.target.value)}
        onClick={e => e.stopPropagation()}
      />
    </div>
  )

  const lifeDisplay = viewMode ? (
    <span className={styles.playerLife}>{p.life}</span>
  ) : editingLife ? (
    <input
      className={styles.inlineInput}
      type="number"
      value={lifeInput}
      onChange={e => setLifeInput(e.target.value)}
      onBlur={commitLife}
      onKeyDown={e => { if (e.key === 'Enter') commitLife(); if (e.key === 'Escape') setEditingLife(false) }}
      autoFocus
    />
  ) : (
    <span className={styles.playerLife} onClick={() => { setLifeInput(String(p.life)); setEditingLife(true) }} title="Click to edit">
      {p.life}
    </span>
  )

  const isPartner = Array.isArray(p.commanderTax)

  function renderTax() {
    if (viewMode) {
      return <span className={styles.playerTax}>{formatTax(p.commanderTax)}</span>
    }
    if (!isPartner) {
      if (editingTax === 0) {
        return (
          <input
            className={styles.inlineInput}
            type="number"
            value={taxInput}
            onChange={e => setTaxInput(e.target.value)}
            onBlur={commitTax}
            onKeyDown={e => { if (e.key === 'Enter') commitTax(); if (e.key === 'Escape') setEditingTax(null) }}
            autoFocus
          />
        )
      }
      return (
        <span className={styles.playerTax} onClick={() => { setTaxInput(String(p.commanderTax)); setEditingTax(0) }} title="Click to edit">
          {formatTax(p.commanderTax)}
        </span>
      )
    }

    const taxArr = p.commanderTax as [number, number]
    return (
      <span className={styles.playerTax}>
        Tax:{' '}
        {editingTax === 0 ? (
          <input
            className={styles.inlineInput}
            type="number"
            value={taxInput}
            onChange={e => setTaxInput(e.target.value)}
            onBlur={commitTax}
            onKeyDown={e => { if (e.key === 'Enter') commitTax(); if (e.key === 'Escape') setEditingTax(null) }}
            autoFocus
          />
        ) : (
          <span onClick={() => { setTaxInput(String(taxArr[0])); setEditingTax(0) }} style={{ cursor: 'pointer' }} title="Click to edit">{taxArr[0]}</span>
        )}
        {' / '}
        {editingTax === 1 ? (
          <input
            className={styles.inlineInput}
            type="number"
            value={taxInput}
            onChange={e => setTaxInput(e.target.value)}
            onBlur={commitTax}
            onKeyDown={e => { if (e.key === 'Enter') commitTax(); if (e.key === 'Escape') setEditingTax(null) }}
            autoFocus
          />
        ) : (
          <span onClick={() => { setTaxInput(String(taxArr[1])); setEditingTax(1) }} style={{ cursor: 'pointer' }} title="Click to edit">{taxArr[1]}</span>
        )}
      </span>
    )
  }

  const playerMetaBlock = (
    <div className={styles.playerMeta}>
      <span className={styles.playerName}>{p.name}</span>
      {lifeDisplay}
      {renderTax()}
      {!viewMode && (editingHandSize ? (
        <input
          className={styles.inlineInput}
          type="number"
          value={handSizeInput}
          onChange={e => setHandSizeInput(e.target.value)}
          onBlur={commitHandSize}
          onKeyDown={e => { if (e.key === 'Enter') commitHandSize(); if (e.key === 'Escape') setEditingHandSize(false) }}
          autoFocus
        />
      ) : (
        <span
          className={styles.playerHandSize}
          onClick={() => { setHandSizeInput(String(handSizes[playerIndex])); setEditingHandSize(true) }}
          title="Click to edit hand size"
        >
          Max: {handSizes[playerIndex]}
        </span>
      ))}
      {!viewMode && (editingSpellsCast ? (
        <input
          className={styles.inlineInput}
          type="number"
          value={spellsCastInput}
          onChange={e => setSpellsCastInput(e.target.value)}
          onBlur={commitSpellsCast}
          onKeyDown={e => { if (e.key === 'Enter') commitSpellsCast(); if (e.key === 'Escape') setEditingSpellsCast(false) }}
          autoFocus
        />
      ) : (
        <span
          className={styles.playerHandSize}
          onClick={() => { setSpellsCastInput(String(turnCounters.spellsCastThisTurn[playerIndex])); setEditingSpellsCast(true) }}
          title="Click to edit — spells cast this turn"
        >
          Spells: {turnCounters.spellsCastThisTurn[playerIndex]}
        </span>
      ))}
      {!viewMode && (editingCardsDrawn ? (
        <input
          className={styles.inlineInput}
          type="number"
          value={cardsDrawnInput}
          onChange={e => setCardsDrawnInput(e.target.value)}
          onBlur={commitCardsDrawn}
          onKeyDown={e => { if (e.key === 'Enter') commitCardsDrawn(); if (e.key === 'Escape') setEditingCardsDrawn(false) }}
          autoFocus
        />
      ) : (
        <span
          className={styles.playerHandSize}
          onClick={() => { setCardsDrawnInput(String(turnCounters.cardsDrawnThisTurn[playerIndex])); setEditingCardsDrawn(true) }}
          title="Click to edit — cards drawn this turn"
        >
          Drawn: {turnCounters.cardsDrawnThisTurn[playerIndex]}
        </span>
      ))}
    </div>
  )

  const strip = (
    <div className={`${styles.strip} ${isTop ? styles.stripTop : ''}`}>
      {isRight && <>{playerMetaBlock}<div className={styles.stripDivider} /></>}
      {isRight ? rightSideZones : leftSideZones}
      {!isRight && <><div className={styles.stripDivider} />{playerMetaBlock}</>}
    </div>
  )

  const battlefield = p.zones.battlefield.cards
  const creatures = battlefield.filter((c: Card) => c.cardType === 'creature')
  const nonlands = battlefield.filter((c: Card) =>
    c.cardType === 'artifact' || c.cardType === 'enchantment' || c.cardType === 'planeswalker'
  )
  const lands = battlefield.filter((c: Card) => c.cardType === 'land')

  function renderBattlefieldCard(card: Card) {
    const dup = !viewMode && !card.isToken && isDuplicate(playerIndex, card.name, card.id) && !dismissedDuplicateWarnings.has(card.id)
    return (
      <div key={card.id} className={styles.battlefieldCardWrap}>
        {dup && (
          <div className={styles.duplicateWarning}>
            <span>Duplicate non-token card</span>
            <button onClick={() => dismissDuplicateWarning(card.id)}>Dismiss</button>
          </div>
        )}
        <BoardCard
          card={card}
          onMove={t => handleMove(card.id, t)}
          onCastToStack={t => handleCastToStack(card.id, t)}
          onRemove={() => handleRemove(card.id)}
          onCreateTokenCopy={() => handleTokenCopy(card.id)}
          onToggleTapped={() => { if (!viewMode) toggleTapped(playerIndex, card.id) }}
          onToggleRevealed={revealHandler(card.id)}
          onToggleDoesNotUntap={() => { if (!viewMode) toggleDoesNotUntap(playerIndex, card.id) }}
          onSetTriggerTag={tag => { if (!viewMode) setTriggerTag(playerIndex, card.id, tag) }}
          onIncrement={!viewMode && card.isToken ? () => incrementToken(playerIndex, card.id) : undefined}
          onDecrement={!viewMode && card.isToken ? () => decrementToken(playerIndex, card.id) : undefined}
          showRemoveX
          currentZone="battlefield"
          readOnly={viewMode}
        />
      </div>
    )
  }

  const sections = [
    <div key="creatures" className={styles.section}>{creatures.map(renderBattlefieldCard)}</div>,
    <div key="nonlands" className={styles.section}>{nonlands.map(renderBattlefieldCard)}</div>,
    <div key="lands" className={styles.section}>{lands.map(renderBattlefieldCard)}</div>,
  ]

  const addBtnClass = isTop ? styles.addCardBtnBottom : styles.addCardBtnTop
  const outerSide = isRight ? styles.outerMenuRight : styles.outerMenuLeft

  const winH = typeof window !== 'undefined' ? window.innerHeight : 800
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1200

  return (
    <div className={styles.playmat}>
      {!viewMode && !isSetupDone && (
        <CommanderSetupModal
          playerIndex={playerIndex}
          playerName={PLAYER_NAMES[playerIndex]}
          onConfirm={handleSetupConfirm}
        />
      )}

      {!viewMode && (
        <button className={`${styles.outerMenuBtn} ${outerSide}`} onClick={openOuterMenu} title="Zone actions">
          ⋮
        </button>
      )}

      {isTop && (
        <div className={styles.stripWrap}>
          {strip}
          {expanded && <div className={styles.expandedAnchorBottom}>{expandedPanel}</div>}
        </div>
      )}

      <div className={styles.battlefield}>
        <div className={styles.watermarkWrap}>
          <Image src="/tark-dark.png" alt="" fill style={{ objectFit: 'contain' }} />
        </div>
        {isTop ? [...sections].reverse() : sections}
        {!viewMode && (
          <button
            ref={addBtnRef}
            className={`${styles.addCardBtn} ${addBtnClass}`}
            onClick={() => {
              const rect = addBtnRef.current?.getBoundingClientRect()
              if (rect) handleAddCard('battlefield', rect)
            }}
          >
            + Add card
          </button>
        )}
      </div>

      {!isTop && (
        <div className={styles.stripWrap}>
          {expanded && <div className={styles.expandedAnchorTop}>{expandedPanel}</div>}
          {strip}
        </div>
      )}

      {!viewMode && showCardSearch && cardSearchRect && (
        <div
          className={styles.searchAnchor}
          style={{
            position: 'fixed',
            top: Math.min(cardSearchRect.bottom + 4, winH - 260),
            left: Math.min(Math.max(cardSearchRect.left, 8), winW - 240),
            zIndex: 1000,
          }}
        >
          <CardAddSearch
            decklist={decklist}
            tokensOnly={showCardSearch.tokensOnly}
            onSelect={handleCardSelected}
            onClose={() => setShowCardSearch(null)}
          />
        </div>
      )}

      {!viewMode && zoneMenu && (
        <ZoneMenu
          x={zoneMenu.x}
          y={zoneMenu.y}
          items={zoneMenu.items}
          onClose={() => setZoneMenu(null)}
        />
      )}

      {!viewMode && showEditPool && createPortal(
        <div className={styles.editPoolBackdrop}>
          <div className={styles.editPoolModal}>
            <div className={styles.editPoolHeader}>
              <span>Edit card pool — {p.name}</span>
              <button className={styles.editPoolClose} onClick={() => setShowEditPool(false)}>×</button>
            </div>
            <p className={styles.editPoolHint}>
              Paste your decklist. The library will be replaced with these cards. Use Shuffle to randomize.
            </p>
            <textarea
              className={styles.editPoolTextarea}
              value={editPoolText}
              onChange={e => setEditPoolText(e.target.value)}
              rows={12}
              placeholder={'1 Sol Ring\n1 Command Tower\n...'}
              spellCheck={false}
            />
            <div className={styles.editPoolActions}>
              <button
                className={styles.editPoolCancelBtn}
                onClick={() => setShowEditPool(false)}
                disabled={editPoolLoading}
              >
                Cancel
              </button>
              <button
                className={styles.editPoolConfirmBtn}
                onClick={handleEditPoolConfirm}
                disabled={editPoolLoading}
              >
                {editPoolLoading ? 'Fetching cards...' : 'Update card pool'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {!viewMode && showLibraryOrder && createPortal(
        <LibraryOrderModal
          cards={pendingLibraryCards}
          targetCount={pendingLibraryTarget}
          onConfirm={handleLibraryOrderConfirm}
          onClose={() => setShowLibraryOrder(false)}
        />,
        document.body
      )}
    </div>
  )
}

function ExpandedRow({ card, readOnly, onMove, onCastToStack, onRemove, onCreateTokenCopy, onIncrement, onDecrement, currentZone }: {
  card: Card
  readOnly?: boolean
  onMove: (t: ZoneTarget) => void
  onCastToStack: (t: StackType) => void
  onRemove: () => void
  onCreateTokenCopy?: () => void
  onIncrement?: () => void
  onDecrement?: () => void
  currentZone: EditableZone
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className={styles.expandedRow}
      onClick={e => e.stopPropagation()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={styles.expandedRowName}>{card.name}</span>
      {!readOnly && (
        <BoardCard
          card={card}
          onMove={onMove}
          onCastToStack={onCastToStack}
          onRemove={onRemove}
          onCreateTokenCopy={onCreateTokenCopy}
          onIncrement={onIncrement}
          onDecrement={onDecrement}
          currentZone={currentZone}
          compact
        />
      )}
      {hovered && card.imageUrl && createPortal(
        <div style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 9998,
          pointerEvents: 'none',
          borderRadius: 8,
          boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
        }}>
          <Image src={card.imageUrl} alt={card.name} width={240} height={336} style={{ borderRadius: 8, display: 'block' }} />
        </div>,
        document.body
      )}
    </div>
  )
}

function LibraryOrderModal({ cards, targetCount, onConfirm, onClose }: {
  cards: Card[]
  targetCount: number
  onConfirm: (cards: Card[]) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'choose' | 'manual'>('choose')
  const [orderedCards, setOrderedCards] = useState<Card[]>(cards)

  function buildFinalLibrary(ordered: Card[]): Card[] {
    const placeholderCount = Math.max(0, targetCount - ordered.length)
    const placeholders = Array.from({ length: placeholderCount }, () => makeUnknownCard())
    return [...placeholders, ...[...ordered].reverse()]
  }

  function handleShuffle() {
    const shuffled = [...cards]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp
    }
    onConfirm(buildFinalLibrary(shuffled))
  }

  function moveUp(index: number) {
    if (index === 0) return
    const updated = [...orderedCards]
    ;[updated[index - 1], updated[index]] = [updated[index], updated[index - 1]]
    setOrderedCards(updated)
  }

  function moveDown(index: number) {
    if (index === orderedCards.length - 1) return
    const updated = [...orderedCards]
    ;[updated[index + 1], updated[index]] = [updated[index], updated[index + 1]]
    setOrderedCards(updated)
  }

  return (
    <div className={styles.libraryOrderBackdrop}>
      <div className={styles.libraryOrderModal}>
        <div className={styles.libraryOrderHeader}>
          <span>Set library order — {cards.length} cards{targetCount > cards.length ? ` + ${targetCount - cards.length} unknown` : ''}</span>
          <button className={styles.editPoolClose} onClick={onClose}>×</button>
        </div>

        {mode === 'choose' ? (
          <div className={styles.libraryOrderChoose}>
            <button className={styles.libraryOrderChooseBtn} onClick={handleShuffle}>
              <span className={styles.libraryOrderChooseBtnTitle}>Shuffle</span>
              <span className={styles.libraryOrderChooseBtnSub}>Randomize card order. Unknown cards fill the bottom.</span>
            </button>
            <button className={styles.libraryOrderChooseBtn} onClick={() => setMode('manual')}>
              <span className={styles.libraryOrderChooseBtnTitle}>Set order manually</span>
              <span className={styles.libraryOrderChooseBtnSub}>Arrange cards. Row 1 is drawn first. Unknown cards fill below.</span>
            </button>
          </div>
        ) : (
          <>
            <p className={styles.libraryOrderHint}>Row 1 is drawn first. Move cards up to put them on top of the library.</p>
            <div className={styles.libraryOrderList}>
              {orderedCards.map((card, i) => (
                <div key={card.id} className={styles.libraryOrderRow}>
                  <span className={styles.libraryOrderRowNum}>{i + 1}</span>
                  <span className={styles.libraryOrderRowName}>{card.name}</span>
                  <div className={styles.libraryOrderMoveButtons}>
                    <button
                      className={styles.libraryOrderMoveBtn}
                      onClick={() => moveUp(i)}
                      disabled={i === 0}
                      title="Move up (drawn sooner)"
                    >↑</button>
                    <button
                      className={styles.libraryOrderMoveBtn}
                      onClick={() => moveDown(i)}
                      disabled={i === orderedCards.length - 1}
                      title="Move down (drawn later)"
                    >↓</button>
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.libraryOrderActions}>
              <button className={styles.libraryOrderBackBtn} onClick={() => setMode('choose')}>
                Back
              </button>
              <button
                className={styles.editPoolConfirmBtn}
                onClick={() => onConfirm(buildFinalLibrary(orderedCards))}
              >
                Confirm order
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CardAddSearch({ decklist, tokensOnly, onSelect, onClose }: {
  decklist: string[]
  tokensOnly?: boolean
  onSelect: (card: Card) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const displayedSuggestions = !tokensOnly && decklist.length > 0 && query.length > 0
    ? decklist.filter(cardName => cardName.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : suggestions

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.length < 1 || (!tokensOnly && decklist.length > 0)) return

    let cancelled = false

    if (tokensOnly) {
      debounceRef.current = setTimeout(async () => {
        setLoading(true)
        try {
          const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(`is:token ${query}`)}&unique=cards`)
		  if (cancelled) return
          if (!res.ok) { setSuggestions([]); return }
          const data = await res.json()
		  if (cancelled) return
          setSuggestions((data.data ?? []).slice(0, 8).map((c: { name: string }) => c.name))
          setActiveIndex(-1)
        } catch {
          setSuggestions([])
        } finally {
		  if (!cancelled) setLoading(false)
        }
      }, 200)
	  return () => {
		cancelled = true
		if (debounceRef.current) clearTimeout(debounceRef.current)
	  }
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(query)}`)
		if (cancelled) return
		if (!res.ok) { setSuggestions([]); return }
        const data = await res.json()
		if (cancelled) return
        setSuggestions((data.data ?? []).slice(0, 8))
        setActiveIndex(-1)
      } catch {
        setSuggestions([])
      } finally {
		if (!cancelled) setLoading(false)
      }
    }, 180)
    return () => {
	  cancelled = true
	  if (debounceRef.current) clearTimeout(debounceRef.current)
	}
  }, [query, tokensOnly, decklist.length])

  async function selectCard(name: string) {
    try {
      const url = tokensOnly
        ? `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`is:token !"${name}"`)}&unique=cards`
        : `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`
      const res = await fetch(url)
      if (!res.ok) return
      const data = await res.json()
      const cardData = tokensOnly ? data.data?.[0] : data
      if (!cardData) return
      const card: Card = {
        id: cardData.id,
        name: (() => {
          if (tokensOnly && cardData.card_faces && cardData.name.includes('//')) {
            const match = cardData.card_faces.find(
              (f: { name: string }) => f.name.toLowerCase().includes(name.toLowerCase())
            )
            return match?.name ?? cardData.name
          }
          return cardData.name
        })(),
        imageUrl: cardData.image_uris?.normal ?? (() => {
          if (!cardData.card_faces) return undefined
          const match = cardData.card_faces.find(
            (f: { name: string }) => f.name.toLowerCase().includes(name.toLowerCase())
          )
          return (match ?? cardData.card_faces[0])?.image_uris?.normal
        })(),
        cardType: parseCardType(cardData.type_line ?? ''),
        isToken: tokensOnly ? true : undefined,
        ...detectCardMetadata(
          cardData.oracle_text ?? cardData.card_faces?.[0]?.oracle_text,
          cardData.keywords ?? cardData.card_faces?.[0]?.keywords
        ),
      }
      onSelect(card)
    } catch { /* ignore */ }
  }

  return (
    <div className={styles.cardAddSearch}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <input
          className={styles.cardAddInput}
          placeholder={tokensOnly ? 'Search tokens...' : decklist.length > 0 ? 'Search decklist...' : 'Search all cards...'}
          value={query}
          onChange={e => {
			const value = e.target.value
			setQuery(value)
			setActiveIndex(-1)
			if (value.length < 1) {
			  setSuggestions([])
			  setLoading(false)
			}
		  }}
          onKeyDown={e => {
            if (e.key === 'Escape') { onClose(); return }
			if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, displayedSuggestions.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, -1)) }
            if (e.key === 'Enter') {
			  const name = activeIndex >= 0 ? displayedSuggestions[activeIndex] : displayedSuggestions[0]
              if (name) void selectCard(name)
            }
          }}
          autoFocus
          autoComplete="off"
        />
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'rgba(232,224,212,0.4)', cursor: 'pointer', fontSize: '1rem', padding: '0 4px', flexShrink: 0 }}
        >
          ×
        </button>
      </div>
      {loading && <div className={styles.cardAddHint}>Searching...</div>}
	  {!loading && query.length >= 1 && displayedSuggestions.length === 0 && (
        <div className={styles.cardAddHint}>No results</div>
      )}
	  {displayedSuggestions.length > 0 && (
        <ul className={styles.cardAddList}>
		  {displayedSuggestions.map((name, i) => (
            <li
              key={name}
              className={`${styles.cardAddItem} ${i === activeIndex ? styles.cardAddItemActive : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => void selectCard(name)}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
