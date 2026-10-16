import type { Card, CardType, EventType, TriggerTag } from '@/types/board'

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
  'you-cast-noncreature': 'You cast a noncreature spell',
  'opponent-draws': 'Opponent draws a card',
  'permanent-etb-yours': 'Your permanent enters the battlefield',
  'opponent-searches': 'Opponent searches their library',
  'your-upkeep': 'Your upkeep',
  'combat-damage-to-player': 'Combat damage to a player',
  'creature-dies': 'A creature dies',
}

export const EVENT_TYPE_LABELS = TRIGGER_LABELS

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
// something would happen "instead" (CR 614.1d).
function hasUsableMatch(oracleText: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const matcher = new RegExp(pattern.source, flags)
  let match: RegExpExecArray | null
  while ((match = matcher.exec(oracleText))) {
    const passage = passageForMatch(oracleText, match.index)
    if (!/would[\s\S]{0,60}instead/i.test(passage)) return true
  }
  return false
}

function spellOrdinal(oracleText: string): number | undefined {
  if (/\bfirst\s+(?:noncreature\s+)?spell\s+each\s+turn/i.test(oracleText)) return 1
  if (/\bsecond\s+spell\s+each\s+turn/i.test(oracleText)) return 2
  return undefined
}

export function detectTriggerTag(oracleText?: string): TriggerTag | undefined {
  if (!oracleText) return undefined

  // Mystic Remora phrases this as "casts a noncreature spell"; Esper
  // Sentinel as "casts their first noncreature spell" — both must match the
  // shared noncreature event tag.
  if (hasUsableMatch(oracleText, /whenever an opponent casts (?:a |their (?:first )?)?noncreature spell/i)) {
    return {
      event: 'opponent-casts-noncreature',
      qualifier: 'noncreature',
      spellNumber: spellOrdinal(oracleText),
    }
  }
  if (hasUsableMatch(oracleText, /whenever an opponent casts a spell/i)) {
    return { event: 'opponent-casts', spellNumber: spellOrdinal(oracleText) }
  }
  // Lotho is phrased "a player" rather than "an opponent". It uses the
  // same spell-cast event, with an explicit scope retained in the compact tag.
  if (hasUsableMatch(oracleText, /whenever a player casts (?:their )?second spell each turn/i)) {
    return { event: 'opponent-casts', spellNumber: 2, controllerScope: 'any-player' }
  }
  if (hasUsableMatch(oracleText, /whenever you cast a noncreature spell/i)) {
    return { event: 'you-cast-noncreature', qualifier: 'noncreature' }
  }
  // Known limitation: Orcish Bowmasters is intentionally tagged here even
  // though draw-for-turn is not modelled yet, so its draw-step exception is
  // left for the author to dismiss.
  if (hasUsableMatch(oracleText, /whenever an opponent draws/i)) {
    return { event: 'opponent-draws' }
  }
  if (hasUsableMatch(oracleText, /when(?:ever)?\s+[^.\n]{0,120}\benters(?:\s+the battlefield)?\b/i)) {
    return { event: 'permanent-etb-yours' }
  }
  if (hasUsableMatch(oracleText, /whenever an opponent searches/i)) {
    return { event: 'opponent-searches' }
  }
  if (hasUsableMatch(oracleText, /at the beginning of your upkeep/i)) {
    return { event: 'your-upkeep' }
  }
  if (hasUsableMatch(oracleText, /whenever .{0,40} deals combat damage to a player/i)) {
    return { event: 'combat-damage-to-player' }
  }
  if (hasUsableMatch(oracleText, /when(?:ever)? .{0,40} dies/i)) {
    return { event: 'creature-dies' }
  }
  return undefined
}

export function detectStormGrant(oracleText?: string): Card['grantsStorm'] | undefined {
  if (!oracleText) return undefined
  const match = /\b(instant and sorcery spells|instant spells|sorcery spells|spells) you cast have storm\b/i.exec(oracleText)
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

export function detectCardMetadata(
  oracleText?: string,
  keywords?: unknown
): Pick<Card, 'triggerTag' | 'hasStorm' | 'grantsStorm'> {
  const hasStorm = Array.isArray(keywords)
    && keywords.some(keyword => typeof keyword === 'string' && keyword.toLowerCase() === 'storm')
  const triggerTag = detectTriggerTag(oracleText)
  const grantsStorm = detectStormGrant(oracleText)
  return {
    ...(triggerTag && { triggerTag }),
    ...(hasStorm && { hasStorm: true }),
    ...(grantsStorm && { grantsStorm }),
  }
}
