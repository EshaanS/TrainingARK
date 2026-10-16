import { describe, expect, it } from 'vitest'
import { detectTriggerTag, detectStormGrant, detectCardMetadata } from './triggerDetection'

// Oracle text below is verbatim from Scryfall (fetched while writing these
// tests), not paraphrased, since the parser is sensitive to exact phrasing.

describe('detectTriggerTag — one case per event, using real oracle text', () => {
  it('Rhystic Study -> opponent-casts', () => {
    expect(detectTriggerTag('Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.'))
      .toEqual({ event: 'opponent-casts' })
  })

  it('Mystic Remora -> opponent-casts-noncreature, no ordinal qualifier', () => {
    const text = 'Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.'
    expect(detectTriggerTag(text)).toEqual({ event: 'opponent-casts-noncreature', qualifier: 'noncreature' })
  })

  it('Esper Sentinel -> opponent-casts-noncreature with spellNumber 1 ("first ... each turn")', () => {
    const text = "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power."
    expect(detectTriggerTag(text)).toEqual({ event: 'opponent-casts-noncreature', qualifier: 'noncreature', spellNumber: 1 })
  })

  it('Lotho, Corrupt Shirriff -> opponent-casts with spellNumber 2 and any-player scope ("a player", not "an opponent")', () => {
    const text = `Whenever a player casts their second spell each turn, you lose 1 life and create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")`
    expect(detectTriggerTag(text)).toEqual({ event: 'opponent-casts', spellNumber: 2, controllerScope: 'any-player' })
  })

  it('you-cast-noncreature matches a plain "whenever you cast a noncreature spell" clause', () => {
    expect(detectTriggerTag('Whenever you cast a noncreature spell, put a +1/+1 counter on this creature.'))
      .toEqual({ event: 'you-cast-noncreature', qualifier: 'noncreature' })
  })

  it('Smothering Tithe -> opponent-draws', () => {
    const text = `Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")`
    expect(detectTriggerTag(text)).toEqual({ event: 'opponent-draws' })
  })

  it('Mulldrifter -> permanent-etb-yours', () => {
    const text = `Flying\nWhen this creature enters, draw two cards.\nEvoke {2}{U} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)`
    expect(detectTriggerTag(text)).toEqual({ event: 'permanent-etb-yours' })
  })

  it('Archivist of Oghma -> opponent-searches', () => {
    expect(detectTriggerTag('Flash\nWhenever an opponent searches their library, you gain 1 life and draw a card.'))
      .toEqual({ event: 'opponent-searches' })
  })

  it('Phyrexian Arena -> your-upkeep', () => {
    expect(detectTriggerTag('At the beginning of your upkeep, you draw a card and lose 1 life.'))
      .toEqual({ event: 'your-upkeep' })
  })

  it('Ragavan, Nimble Pilferer -> combat-damage-to-player', () => {
    const text = `Whenever Ragavan deals combat damage to a player, create a Treasure token and exile the top card of that player's library. Until end of turn, you may cast that card.\nDash {1}{R} (You may cast this spell for its dash cost. If you do, it gains haste, and it's returned from the battlefield to its owner's hand at the beginning of the next end step.)`
    expect(detectTriggerTag(text)).toEqual({ event: 'combat-damage-to-player' })
  })

  it('Blood Artist -> creature-dies', () => {
    expect(detectTriggerTag('Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life.'))
      .toEqual({ event: 'creature-dies' })
  })
})

describe('detectTriggerTag — replacement effects are not triggers (CR 614.1d)', () => {
  it('Temple of Mystery: "enters tapped" alone is excluded, but the real "When this land enters" trigger on the same card still matches', () => {
    const text = `This land enters tapped.\nWhen this land enters, scry 1. (Look at the top card of your library. You may put that card on the bottom.)\n{T}: Add {G} or {U}.`
    expect(detectTriggerTag(text)).toEqual({ event: 'permanent-etb-yours' })
  })

  it('Walking Ballista: "enters with X counters", with no When/Whenever anywhere in the text, produces no trigger tag at all', () => {
    const text = `This creature enters with X +1/+1 counters on it.\n{4}: Put a +1/+1 counter on this creature.\nRemove a +1/+1 counter from this creature: It deals 1 damage to any target.`
    expect(detectTriggerTag(text)).toBeUndefined()
  })

  it('a When/Whenever clause is rejected when the same sentence says something would happen "instead", even though it syntactically matches the ETB pattern', () => {
    // Synthetic text — no real card combines a when/whenever ETB trigger and
    // a would/instead replacement clause in a single sentence like this, but
    // the rejection must hold regardless of which pattern matched.
    const text = 'Whenever this permanent would enter the battlefield tapped, it enters untapped instead.'
    expect(detectTriggerTag(text)).toBeUndefined()
  })
})

describe('detectTriggerTag — priority order', () => {
  it('Orcish Bowmasters matches both an ETB clause and an opponent-draws clause; opponent-draws is checked first and wins (known limitation, see Task 5 / lib/triggerDetection.ts)', () => {
    const text = 'Flash\nWhen this creature enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, this creature deals 1 damage to any target. Then amass Orcs 1.'
    expect(detectTriggerTag(text)).toEqual({ event: 'opponent-draws' })
  })
})

describe('storm detection', () => {
  it('Grapeshot has native storm via the keywords array; its oracle text alone produces no triggerTag', () => {
    const text = 'Grapeshot deals 1 damage to any target.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)'
    const metadata = detectCardMetadata(text, ['Storm'])
    expect(metadata.hasStorm).toBe(true)
    expect(metadata.triggerTag).toBeUndefined()
    expect(metadata.grantsStorm).toBeUndefined()
  })

  it('Prismari, the Inspiration grants storm to instants/sorceries without having it itself (its own keywords array has no Storm)', () => {
    const text = `Flying\nWard—Pay 5 life.\nInstant and sorcery spells you cast have storm. (Whenever you cast an instant or sorcery spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)`
    const metadata = detectCardMetadata(text, ['Flying', 'Ward'])
    expect(metadata.hasStorm).toBeUndefined()
    expect(metadata.grantsStorm).toEqual({ toTypes: ['instant', 'sorcery'] })
    expect(metadata.triggerTag).toBeUndefined()
  })

  it('detectStormGrant restricts the type list for "instant spells"/"sorcery spells" and grants to every type for a bare "spells you cast have storm"', () => {
    expect(detectStormGrant('Instant spells you cast have storm.')).toEqual({ toTypes: ['instant'] })
    expect(detectStormGrant('Sorcery spells you cast have storm.')).toEqual({ toTypes: ['sorcery'] })
    expect(detectStormGrant('Spells you cast have storm.')).toEqual({
      toTypes: ['creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'instant', 'sorcery', 'battle'],
    })
  })

  it('detectCardMetadata returns an empty object when there is no oracle text and no keywords', () => {
    expect(detectCardMetadata(undefined, undefined)).toEqual({})
  })
})
