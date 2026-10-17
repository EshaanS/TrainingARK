export type CardType =
  | 'creature'
  | 'artifact'
  | 'enchantment'
  | 'planeswalker'
  | 'land'
  | 'instant'
  | 'sorcery'
  | 'battle'

export type EventType =
  | 'opponent-casts'
  | 'opponent-casts-noncreature'
  | 'any-player-casts'
  | 'you-cast-noncreature'
  | 'opponent-draws'
  | 'any-player-draws'
  | 'permanent-etb-yours'
  | 'opponent-searches'
  | 'your-upkeep'
  | 'combat-damage-to-player'
  | 'creature-dies'

// What a trigger does when it resolves, for the few effects the builder does
// bookkeeping for. Anything else has no effect and resolving it is a no-op.
// Library searches are not an effect kind: Card.searchesLibrary already
// carries that fact.
export type TriggerEffect =
  | { kind: 'draw', count: number }
  | { kind: 'createToken', count: number, tokenName: string }

export interface TriggerTag {
  event: EventType
  // Narrows which events match. any-player-casts carries its noncreature
  // restriction here (the opponent-scoped cast events encode it in the event
  // type instead). 'not-draw-step-draw' is Orcish Bowmasters' "except the
  // first one they draw in each of their draw steps": a drawForTurn draw does
  // not match, every other draw does.
  qualifier?: 'noncreature' | 'not-draw-step-draw'
  // Some triggered abilities contain a simple ordinal condition. This is a
  // suggestion gate only: authors can always add the ability manually.
  // Despite the name, for opponent-draws it is the nth card drawn this turn.
  // Kept as-is because tags are persisted inside saved scenario snapshots.
  spellNumber?: number
  effect?: TriggerEffect
}

// A replacement effect (Alhammarret's Archive, Notion Thief, Anointed
// Procession) that changes how a draw or token effect actually plays out.
// Only used to warn the author — the builder never applies it.
export interface CountReplacement {
  kind: TriggerEffect['kind']
  affects: 'controller' | 'opponents'
}

export interface TurnCounters {
  spellsCastThisTurn: [number, number, number, number]
  totalSpellsCastThisTurn: number
  cardsDrawnThisTurn: [number, number, number, number]
  // Informational only: every land that reaches a battlefield counts, however
  // it got there, and nothing enforces a limit.
  landDropsThisTurn: [number, number, number, number]
}

export interface Card {
  id: string
  name: string
  imageUrl?: string
  cardType: CardType
  tapped?: boolean
  faceDown?: boolean
  counters?: Record<string, number>
  isToken?: boolean
  isCommander?: boolean
  stackCount?: number
  // Author-controlled per-card reveal. An opponent card marked revealed shows
  // its face in the viewer even inside a zone that is otherwise hidden.
  revealed?: boolean
  // Compact, parser-derived metadata. Oracle text itself is intentionally not
  // retained because cards are included in every saved board-state snapshot.
  triggerTag?: TriggerTag
  hasStorm?: boolean
  grantsStorm?: { toTypes: CardType[] }
  // Casting or activating this card searches its controller's library, which
  // offers opponent-searches triggers (Archivist of Oghma).
  searchesLibrary?: boolean
  countReplacements?: CountReplacement[]
  doesNotUntap?: boolean
}

export interface Zone {
  cards: Card[]
  revealed: boolean
  cardCount?: number
}

export interface Player {
  id: string
  name: string
  life: number
  commanderTax: number | [number, number]
  zones: {
    battlefield: Zone
    hand: Zone
    graveyard: Zone
    exile: Zone
    command: Zone
    library: Zone
  }
}

export interface StackItem {
  id: string
  sourceCardId: string
  sourceCardName: string
  controller: string
  label: string
  type: 'cast' | 'triggered' | 'activated'
  imageUrl?: string
  cardType?: CardType
  sourceCard?: Card
  // A storm trigger locks this number when it is created. Its copies are
  // actual individual stack objects, marked so they never go to a zone.
  stormCopyCount?: number
  isStormCopy?: boolean
}

export type PlayerPosition = 'bottom-right' | 'bottom-left' | 'top-left' | 'top-right'
