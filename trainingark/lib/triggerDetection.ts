import type { Card, CardType, CountReplacement, EventType, TriggerEffect, TriggerTag } from '@/types/board'

const ALL_CARD_TYPES: CardType[] = [
  'creature',
  'artifact',
  'enchantment',
  'planeswalker',
  'land',
  'instant',
  'sorcery',
  'battle',
]

const TRIGGER_LABELS: Record<EventType, string> = {
  'opponent-casts': 'Opponent casts a spell',
  'opponent-casts-noncreature': 'Opponent casts a noncreature spell',
  'any-player-casts': 'A player casts a spell',
  'you-cast-noncreature': 'You cast a noncreature spell',
  'opponent-draws': 'Opponent draws a card',
  'any-player-draws': 'A player draws a card',
  'permanent-etb-yours': 'Your permanent enters the battlefield',
  'opponent-searches': 'Opponent searches their library',
  'your-upkeep': 'Your upkeep',
  'combat-damage-to-player': 'Combat damage to a player',
  'creature-dies': 'A creature dies',
}

export const EVENT_TYPE_LABELS = TRIGGER_LABELS

// Text in double quotes is an ability given to something else — an emblem
// (Kaito, Cunning Infiltrator's "Whenever a player casts a spell ..."), a
// token, another permanent — never one the card itself has. Every exported
// detector reads the text through this. Quoted spans are blanked rather than
// removed so match indices still line up with the original text.
function withoutQuotedText(oracleText: string): string {
  return oracleText.replace(/"[^"]*"/g, quoted => quoted.replace(/[^\n]/g, ' '))
}

function passageForMatch(oracleText: string, matchIndex: number): string {
  const before = oracleText.slice(0, matchIndex)
  const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('\n')) + 1
  const after = oracleText.slice(matchIndex)
  const period = after.indexOf('.')
  const newline = after.indexOf('\n')
  const ends = [period, newline].filter(index => index >= 0)
  const end = ends.length > 0 ? matchIndex + Math.min(...ends) + 1 : oracleText.length
  return oracleText.slice(start, end)
}

// Replacement effects never use the stack. Besides requiring an explicit
// When/Whenever ETB clause, reject any matched rules-text sentence that says
// something would happen "instead" (CR 614.1d). Returns where the first
// usable match starts, or -1.
function usableMatchIndex(oracleText: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const matcher = new RegExp(pattern.source, flags)
  let match: RegExpExecArray | null
  while ((match = matcher.exec(oracleText))) {
    const passage = passageForMatch(oracleText, match.index)
    if (!/would[\s\S]{0,60}instead/i.test(passage)) return match.index
  }
  return -1
}

function spellOrdinal(oracleText: string): number | undefined {
  if (/\bfirst\s+(?:noncreature\s+)?spell\s+each\s+turn/i.test(oracleText)) return 1
  if (/\bsecond\s+spell\s+each\s+turn/i.test(oracleText)) return 2
  return undefined
}

// Faerie Mastermind and Gleaming Splendor: "draws their second card each
// turn". Bowmasters' "except the first one they draw in each of their draw
// steps" deliberately does not match — it is not a simple ordinal; see
// drawTag.
function drawOrdinal(oracleText: string): number | undefined {
  if (/\bdraws\s+their\s+first\s+card\s+each\s+turn/i.test(oracleText)) return 1
  if (/\bdraws\s+their\s+second\s+card\s+each\s+turn/i.test(oracleText)) return 2
  return undefined
}

// Orcish Bowmasters, Xyris, the Writhing Storm, and Leela, Sevateem Warrior
// exclude "the first one they draw in each of their draw steps" — the
// turn-based draw, which the author records with drawForTurn.
function drawTag(event: 'opponent-draws' | 'any-player-draws', oracleText: string): TriggerTag {
  const ordinal = drawOrdinal(oracleText)
  const exceptDrawStep = /\bexcept the first one they draw in each of their draw steps\b/i.test(oracleText)
  return {
    event,
    ...(ordinal !== undefined && { spellNumber: ordinal }),
    ...(exceptDrawStep && { qualifier: 'not-draw-step-draw' as const }),
  }
}

function detectTriggerEvent(oracleText: string): { tag: TriggerTag, index: number } | undefined {
  let index = -1
  const found = (pattern: RegExp) => (index = usableMatchIndex(oracleText, pattern)) !== -1

  // Mystic Remora phrases this as "casts a noncreature spell"; Esper
  // Sentinel as "casts their first noncreature spell" — both must match the
  // shared noncreature event tag.
  if (found(/whenever an opponent casts (?:a |their (?:first )?)?noncreature spell/i)) {
    return {
      index,
      tag: { event: 'opponent-casts-noncreature', qualifier: 'noncreature', spellNumber: spellOrdinal(oracleText) },
    }
  }
  if (found(/whenever an opponent casts a spell/i)) {
    return { index, tag: { event: 'opponent-casts', spellNumber: spellOrdinal(oracleText) } }
  }
  // "A player" includes the trigger's controller (Lotho, Ledger Shredder,
  // Ruric Thar). Stricter than the opponent patterns: the condition must end
  // right after "spell" / "spell each turn", so narrower conditions the
  // builder cannot check ("a spell from their hand", "a spell with mana value
  // 3 or less") and intervening-if conditions ("a spell, if no mana was
  // spent" — Vexing Bauble) are not suggested on every cast.
  if (found(/whenever a player casts (?:a|their (?:first|second)) noncreature spell(?: each turn)?, (?!if\b)/i)) {
    return { index, tag: { event: 'any-player-casts', qualifier: 'noncreature', spellNumber: spellOrdinal(oracleText) } }
  }
  if (found(/whenever a player casts (?:a|their (?:first|second)) spell(?: each turn)?, (?!if\b)/i)) {
    return { index, tag: { event: 'any-player-casts', spellNumber: spellOrdinal(oracleText) } }
  }
  if (found(/whenever you cast a noncreature spell/i)) {
    return { index, tag: { event: 'you-cast-noncreature', qualifier: 'noncreature' } }
  }
  if (found(/whenever an opponent draws/i)) {
    return { index, tag: drawTag('opponent-draws', oracleText) }
  }
  // King T'Challa. Same strictness as any-player-casts: The Council of Four's
  // "second card during their turn" is not a plain ordinal.
  if (found(/whenever a player draws (?:a card|their (?:first|second) card each turn), (?!if\b)/i)) {
    return { index, tag: drawTag('any-player-draws', oracleText) }
  }
  if (found(/when(?:ever)?\s+[^.\n]{0,120}\benters(?:\s+the battlefield)?\b/i)) {
    return { index, tag: { event: 'permanent-etb-yours' } }
  }
  if (found(/whenever an opponent searches/i)) {
    return { index, tag: { event: 'opponent-searches' } }
  }
  if (found(/at the beginning of your upkeep/i)) {
    return { index, tag: { event: 'your-upkeep' } }
  }
  if (found(/whenever .{0,40} deals combat damage to a player/i)) {
    return { index, tag: { event: 'combat-damage-to-player' } }
  }
  if (found(/when(?:ever)? .{0,40} dies/i)) {
    return { index, tag: { event: 'creature-dies' } }
  }
  return undefined
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}
const COUNT = '(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)'

function parseCount(word: string): number {
  return NUMBER_WORDS[word.toLowerCase()] ?? parseInt(word, 10)
}

// The effect half of the triggered ability whose condition starts at
// `index`: the rest of that ability's paragraph after the condition's comma,
// minus reminder text. Scoping to the paragraph keeps other abilities on the
// card (Faerie Mastermind's "{3}{U}: Each player draws a card") out of it;
// taking the whole paragraph rather than one sentence keeps Smothering
// Tithe's "If the player doesn't, you create a Treasure token" in it.
function effectTextAt(oracleText: string, index: number): string {
  const lineStart = oracleText.lastIndexOf('\n', index - 1) + 1
  const lineEnd = oracleText.indexOf('\n', index)
  const line = oracleText.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).replace(/\([^)]*\)/g, '')
  const comma = line.indexOf(',', index - lineStart)
  return comma === -1 ? '' : line.slice(comma + 1).trim()
}

// Deliberately narrow: only a draw or token creation done by the trigger's
// controller ("you draw", "you may draw", a bare imperative "draw", "and
// create"). "Each player draws" or "that player draws" is someone else's
// draw and stays a no-op, as does any count that is not a number word or
// digit ("draw X cards").
export function detectTriggerEffect(effectText: string): TriggerEffect | undefined {
  effectText = withoutQuotedText(effectText)
  const lead = '(?:^|[,.]\\s+|\\byou\\s+(?:may\\s+)?|\\band\\s+|\\bthen\\s+)'
  const draw = new RegExp(`${lead}draw\\s+${COUNT}\\s+cards?\\b`, 'i').exec(effectText)
  if (draw) return { kind: 'draw', count: parseCount(draw[1]) }
  const token = new RegExp(`${lead}create\\s+${COUNT}\\s+([^,.]+?)\\s+tokens?\\b`, 'i').exec(effectText)
  if (token) return { kind: 'createToken', count: parseCount(token[1]), tokenName: token[2] }
  return undefined
}

export function detectTriggerTag(oracleText?: string): TriggerTag | undefined {
  if (!oracleText) return undefined
  oracleText = withoutQuotedText(oracleText)
  const detected = detectTriggerEvent(oracleText)
  if (!detected) return undefined
  const effect = detectTriggerEffect(effectTextAt(oracleText, detected.index))
  return effect ? { ...detected.tag, effect } : detected.tag
}

// "If you would draw a card ..." (Alhammarret's Archive), "If an opponent
// would draw a card ..." (Notion Thief), "If one or more tokens would be
// created under your control" (Mondrak), "If an effect would create one or
// more tokens under your control" (Anointed Procession). Whose draws or
// tokens it touches is read from the "if" clause's subject.
export function detectCountReplacements(oracleText?: string): CountReplacement[] {
  if (!oracleText) return []
  oracleText = withoutQuotedText(oracleText)
  const replacements: CountReplacement[] = []
  const matcher = /\bif ([^.]{0,60}?)\bwould (draw|create|be created)\b/gi
  let match: RegExpExecArray | null
  while ((match = matcher.exec(oracleText))) {
    const passage = passageForMatch(oracleText, match.index)
    const kind: CountReplacement['kind'] = match[2].toLowerCase() === 'draw' ? 'draw' : 'createToken'
    if (kind === 'createToken' && !/\btokens?\b/i.test(passage)) continue
    const affects = /\bopponents?\b/i.test(match[1]) ? 'opponents' : 'controller'
    if (!replacements.some(r => r.kind === kind && r.affects === affects)) replacements.push({ kind, affects })
  }
  return replacements
}

export function detectStormGrant(oracleText?: string): Card['grantsStorm'] | undefined {
  if (!oracleText) return undefined
  const match = /\b(instant and sorcery spells|instant spells|sorcery spells|spells) you cast have storm\b/i.exec(withoutQuotedText(oracleText))
  if (!match) return undefined
  const subject = match[1].toLowerCase()
  const toTypes: CardType[] = subject === 'instant and sorcery spells'
    ? ['instant', 'sorcery']
    : subject === 'instant spells'
      ? ['instant']
      : subject === 'sorcery spells'
        ? ['sorcery']
        : ALL_CARD_TYPES
  return { toTypes }
}

// Matches the card's own controller searching: tutors, Crop Rotation, Green
// Sun's Zenith, Finale of Devastation ("search your library and/or
// graveyard"), and fetch lands. Deliberately does not match Boseiju ("That
// player may search their library" — an opponent searches, not you) or
// Opposition Agent ("while they're searching their libraries" — static).
export function detectSearchesLibrary(oracleText?: string): boolean {
  return !!oracleText && /\bsearch your library\b/i.test(withoutQuotedText(oracleText))
}

export function detectCardMetadata(
  oracleText?: string,
  keywords?: unknown
): Pick<Card, 'triggerTag' | 'hasStorm' | 'grantsStorm' | 'searchesLibrary' | 'countReplacements'> {
  const hasStorm = Array.isArray(keywords)
    && keywords.some(keyword => typeof keyword === 'string' && keyword.toLowerCase() === 'storm')
  const triggerTag = detectTriggerTag(oracleText)
  const grantsStorm = detectStormGrant(oracleText)
  const searchesLibrary = detectSearchesLibrary(oracleText)
  const countReplacements = detectCountReplacements(oracleText)
  return {
    ...(triggerTag && { triggerTag }),
    ...(hasStorm && { hasStorm: true }),
    ...(grantsStorm && { grantsStorm }),
    ...(searchesLibrary && { searchesLibrary: true }),
    ...(countReplacements.length > 0 && { countReplacements }),
  }
}
