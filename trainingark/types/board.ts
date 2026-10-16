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
  | 'you-cast-noncreature'
  | 'opponent-draws'
  | 'permanent-etb-yours'
  | 'opponent-searches'
  | 'your-upkeep'
  | 'combat-damage-to-player'
  | 'creature-dies'

export interface TriggerTag {
  event: EventType
  qualifier?: 'noncreature'
  // Some triggered abilities contain a simple ordinal condition. This is a
  // suggestion gate only: authors can always add the ability manually.
  spellNumber?: number
  controllerScope?: 'opponents' | 'any-player'
}

export interface TurnCounters {
  spellsCastThisTurn: [number, number, number, number]
  totalSpellsCastThisTurn: number
  cardsDrawnThisTurn: [number, number, number, number]
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
