import { describe, expect, it } from 'vitest'
import { detectTriggerTag, detectStormGrant, detectCardMetadata, detectSearchesLibrary, detectTriggerEffect, detectCountReplacements, retagTrigger } from './triggerDetection'

// Oracle text below is verbatim from Scryfall (fetched while writing these
// tests), not paraphrased, since the parser is sensitive to exact phrasing.

describe('detectTriggerTag — one case per event, using real oracle text', () => {
  it('Rhystic Study -> opponent-casts', () => {
    expect(detectTriggerTag('Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.'))
      .toEqual({ event: 'opponent-casts', effect: { kind: 'draw', count: 1 } })
  })

  it('Mystic Remora -> opponent-casts-noncreature, no ordinal qualifier', () => {
    const text = 'Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.'
    expect(detectTriggerTag(text)).toEqual({ event: 'opponent-casts-noncreature', qualifier: 'noncreature', effect: { kind: 'draw', count: 1 } })
  })

  it('Esper Sentinel -> opponent-casts-noncreature with spellNumber 1 ("first ... each turn")', () => {
    const text = "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power."
    expect(detectTriggerTag(text)).toEqual({ event: 'opponent-casts-noncreature', qualifier: 'noncreature', spellNumber: 1, effect: { kind: 'draw', count: 1 } })
  })

  it('Lotho, Corrupt Shirriff -> any-player-casts with spellNumber 2 ("a player", not "an opponent")', () => {
    const text = `Whenever a player casts their second spell each turn, you lose 1 life and create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")`
    expect(detectTriggerTag(text)).toEqual({ event: 'any-player-casts', spellNumber: 2, effect: { kind: 'createToken', count: 1, tokenName: 'Treasure' } })
  })

  it('you-cast-noncreature matches a plain "whenever you cast a noncreature spell" clause', () => {
    expect(detectTriggerTag('Whenever you cast a noncreature spell, put a +1/+1 counter on this creature.'))
      .toEqual({ event: 'you-cast-noncreature', qualifier: 'noncreature' })
  })

  it('Smothering Tithe -> opponent-draws', () => {
    const text = `Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")`
    expect(detectTriggerTag(text)).toEqual({ event: 'opponent-draws', effect: { kind: 'createToken', count: 1, tokenName: 'Treasure' } })
  })

  it('Mulldrifter -> permanent-etb-yours, about itself only', () => {
    const text = `Flying\nWhen this creature enters, draw two cards.\nEvoke {2}{U} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)`
    expect(detectTriggerTag(text)).toEqual({ event: 'permanent-etb-yours', qualifier: 'self', effect: { kind: 'draw', count: 2 } })
  })

  it('Archivist of Oghma -> opponent-searches', () => {
    expect(detectTriggerTag('Flash\nWhenever an opponent searches their library, you gain 1 life and draw a card.'))
      .toEqual({ event: 'opponent-searches', effect: { kind: 'draw', count: 1 } })
  })

  it('Phyrexian Arena -> your-upkeep', () => {
    expect(detectTriggerTag('At the beginning of your upkeep, you draw a card and lose 1 life.'))
      .toEqual({ event: 'your-upkeep', effect: { kind: 'draw', count: 1 } })
  })

  it('Ragavan, Nimble Pilferer -> combat-damage-to-player', () => {
    const text = `Whenever Ragavan deals combat damage to a player, create a Treasure token and exile the top card of that player's library. Until end of turn, you may cast that card.\nDash {1}{R} (You may cast this spell for its dash cost. If you do, it gains haste, and it's returned from the battlefield to its owner's hand at the beginning of the next end step.)`
    expect(detectTriggerTag(text)).toEqual({ event: 'combat-damage-to-player', effect: { kind: 'createToken', count: 1, tokenName: 'Treasure' } })
  })

  it('Blood Artist -> creature-dies', () => {
    expect(detectTriggerTag('Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life.'))
      .toEqual({ event: 'creature-dies' })
  })
})

describe('detectTriggerTag — ordinal draw triggers ("second card each turn")', () => {
  it('Faerie Mastermind -> opponent-draws with ordinal 2', () => {
    const text = 'Flash\nFlying\nWhenever an opponent draws their second card each turn, you draw a card.\n{3}{U}: Each player draws a card.'
    expect(detectTriggerTag(text)).toEqual({ event: 'opponent-draws', spellNumber: 2, effect: { kind: 'draw', count: 1 } })
  })

  it('Gleaming Splendor -> opponent-draws with ordinal 2', () => {
    const text = 'Whenever an opponent draws their second card each turn, you create a Treasure token.\n{2}{W}: Two target players each draw a card.'
    expect(detectTriggerTag(text)).toEqual({ event: 'opponent-draws', spellNumber: 2, effect: { kind: 'createToken', count: 1, tokenName: 'Treasure' } })
  })
})

describe('detectTriggerTag — "except the first one they draw in each of their draw steps"', () => {
  it.each([
    ['Orcish Bowmasters', 'Flash\nWhen this creature enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, this creature deals 1 damage to any target. Then amass Orcs 1.', undefined],
    ['Xyris, the Writhing Storm', 'Flying\nWhenever an opponent draws a card except the first one they draw in each of their draw steps, create a 1/1 green Snake creature token.\nWhenever Xyris deals combat damage to a player, you and that player each draw that many cards.', { kind: 'createToken', count: 1, tokenName: '1/1 green Snake creature' }],
    ['Leela, Sevateem Warrior', "Whenever an opponent draws a card except the first one they draw in each of their draw steps, put a +1/+1 counter on Leela.\nDoctor's companion (You can have two commanders if the other is the Doctor.)", undefined],
  ])('%s -> opponent-draws excluding the draw-step draw', (_name, text, effect) => {
    expect(detectTriggerTag(text)).toEqual({ event: 'opponent-draws', qualifier: 'not-draw-step-draw', ...(effect && { effect }) })
  })

  it('a plain opponent-draws trigger has no draw-step exception (Smothering Tithe)', () => {
    const text = `Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")`
    expect(detectTriggerTag(text)?.qualifier).toBeUndefined()
  })
})

describe('detectTriggerTag — "a player" triggers include the controller (any-player-draws / any-player-casts)', () => {
  it("King T'Challa's front face -> any-player-draws with ordinal 2 and a draw-1 effect", () => {
    const text = "Flash\nWhenever a player draws their second card each turn, you draw a card.\n{4}{W}{U}: Transform King T'Challa. Activate only as a sorcery."
    expect(detectTriggerTag(text)).toEqual({ event: 'any-player-draws', spellNumber: 2, effect: { kind: 'draw', count: 1 } })
  })

  it('Spiteful Visions -> any-player-draws on every draw, no effect (damage is not modelled)', () => {
    const text = "At the beginning of each player's draw step, that player draws an additional card.\nWhenever a player draws a card, this enchantment deals 1 damage to that player."
    expect(detectTriggerTag(text)).toEqual({ event: 'any-player-draws' })
  })

  it('Ledger Shredder -> any-player-casts with ordinal 2; connive is not a modelled effect', () => {
    const text = 'Flying\nWhenever a player casts their second spell each turn, this creature connives. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature.)'
    expect(detectTriggerTag(text)).toEqual({ event: 'any-player-casts', spellNumber: 2 })
  })

  it('The Lord of Pain -> any-player-casts with ordinal 1', () => {
    const text = "Menace\nYour opponents can't gain life.\nWhenever a player casts their first spell each turn, choose another target player. The Lord of Pain deals damage equal to that spell's mana value to the chosen player."
    expect(detectTriggerTag(text)).toEqual({ event: 'any-player-casts', spellNumber: 1 })
  })

  it('Ruric Thar -> any-player-casts with the noncreature qualifier', () => {
    const text = 'Reach, vigilance\nRuric Thar attacks each combat if able.\nWhenever a player casts a noncreature spell, Ruric Thar deals 6 damage to that player.'
    expect(detectTriggerTag(text)).toEqual({ event: 'any-player-casts', qualifier: 'noncreature' })
  })

  it('conditions the builder cannot check are not suggested on every cast or draw', () => {
    // Intervening "if" — only free spells.
    expect(detectTriggerTag('Whenever a player casts a spell, if no mana was spent to cast it, counter that spell.\n{1}, {T}, Sacrifice this artifact: Draw a card.'))
      .toBeUndefined()
    // "During their turn" is not the per-turn ordinal the counters track.
    expect(detectTriggerTag('Whenever a player draws their second card during their turn, you draw a card.\nWhenever a player casts their second spell during their turn, you create a 2/2 white Knight creature token.'))
      .toBeUndefined()
    // A narrower spell condition (Possibility Storm).
    expect(detectTriggerTag('Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put all cards exiled with this enchantment on the bottom of their library in a random order.'))
      .toBeUndefined()
  })

  it("an emblem's quoted trigger is not the planeswalker's own (Ob Nixilis Reignited)", () => {
    const text = '+1: You draw a card and you lose 1 life.\n−3: Destroy target creature.\n−8: Target opponent gets an emblem with "Whenever a player draws a card, you lose 2 life."'
    expect(detectTriggerTag(text)).toBeUndefined()
  })
})

describe('quoted text is never the card\'s own ability — one guard for every detector', () => {
  it("Kaito, Cunning Infiltrator is tagged from its own loyalty trigger, never from its emblem's quoted cast trigger", () => {
    const text = 'Whenever a creature you control deals combat damage to a player, put a loyalty counter on Kaito.\n+1: Up to one target creature you control can\'t be blocked this turn. Draw a card, then discard a card.\n−2: Create a 2/1 blue Ninja creature token.\n−9: You get an emblem with "Whenever a player casts a spell, you create a 2/1 blue Ninja creature token."'
    expect(detectTriggerTag(text)).toEqual({ event: 'combat-damage-to-player' })
  })

  it('an ability granted to an enchanted creature is not the Aura\'s (Curious Obsession, The Tabernacle at Pendrell Vale)', () => {
    expect(detectTriggerTag('Enchant creature\nEnchanted creature gets +1/+1 and has "Whenever this creature deals combat damage to a player, you may draw a card."\nAt the beginning of your end step, if you didn\'t attack with a creature this turn, sacrifice this Aura.'))
      .toBeUndefined()
    expect(detectTriggerTag('All creatures have "At the beginning of your upkeep, destroy this creature unless you pay {1}."'))
      .toBeUndefined()
  })

  it("Sticky Fingers: the granted combat-damage Treasure trigger is skipped and the Aura's own dies trigger is found", () => {
    const text = 'Enchant creature\nEnchanted creature has menace and "Whenever this creature deals combat damage to a player, create a Treasure token." (It can\'t be blocked except by two or more creatures. The token is an artifact with "{T}, Sacrifice this token: Add one mana of any color.")\nWhen enchanted creature dies, draw a card.'
    expect(detectTriggerTag(text)).toEqual({ event: 'creature-dies', effect: { kind: 'draw', count: 1 } })
  })

  it('a quoted draw inside a trigger\'s effect is not that trigger\'s effect (Sygg grants "... draw a card")', () => {
    const text = 'Sygg can\'t be blocked.\nWhenever this creature enters or transforms into Sygg, Wanderwine Wisdom, target creature gains "Whenever this creature deals combat damage to a player or planeswalker, draw a card" until end of turn.\nAt the beginning of your first main phase, you may pay {W}. If you do, transform Sygg.'
    expect(detectTriggerTag(text)).toEqual({ event: 'permanent-etb-yours', qualifier: 'self' })
  })

  it("a search in an emblem is not the planeswalker's own search (Tezzeret, Artifice Master)", () => {
    const text = '+1: Create a 1/1 colorless Thopter artifact creature token with flying.\n0: Draw a card. If you control three or more artifacts, draw two cards instead.\n−9: You get an emblem with "At the beginning of your end step, search your library for a permanent card, put it onto the battlefield, then shuffle."'
    expect(detectSearchesLibrary(text)).toBe(false)
    expect(detectCardMetadata(text)).toEqual({})
  })
})

describe('detectSearchesLibrary — cards that search their controller\'s library', () => {
  // Verbatim Scryfall oracle text, fetched live.
  const searchers: [string, string][] = [
    ['Demonic Tutor', 'Search your library for a card, put that card into your hand, then shuffle.'],
    ['Vampiric Tutor', 'Search your library for a card, then shuffle and put that card on top. You lose 2 life.'],
    ['Enlightened Tutor', 'Search your library for an artifact or enchantment card, reveal it, then shuffle and put that card on top.'],
    ['Mystical Tutor', 'Search your library for an instant or sorcery card, reveal it, then shuffle and put that card on top.'],
    ['Worldly Tutor', 'Search your library for a creature card, reveal it, then shuffle and put the card on top.'],
    ['Crop Rotation', 'As an additional cost to cast this spell, sacrifice a land.\nSearch your library for a land card, put that card onto the battlefield, then shuffle.'],
    ["Green Sun's Zenith", "Search your library for a green creature card with mana value X or less, put it onto the battlefield, then shuffle. Shuffle Green Sun's Zenith into its owner's library."],
    ['Chord of Calling', "Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\nSearch your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle."],
    ['Finale of Devastation', 'Search your library and/or graveyard for a creature card with mana value X or less and put it onto the battlefield. If you search your library this way, shuffle. If X is 10 or more, creatures you control get +X/+X and gain haste until end of turn.'],
    ['Scalding Tarn', '{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.'],
    ['Polluted Delta', '{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.'],
    ['Misty Rainforest', '{T}, Pay 1 life, Sacrifice this land: Search your library for a Forest or Island card, put it onto the battlefield, then shuffle.'],
    ['Flooded Strand', '{T}, Pay 1 life, Sacrifice this land: Search your library for a Plains or Island card, put it onto the battlefield, then shuffle.'],
    ['Verdant Catacombs', '{T}, Pay 1 life, Sacrifice this land: Search your library for a Swamp or Forest card, put it onto the battlefield, then shuffle.'],
  ]

  it.each(searchers)('%s is flagged searchesLibrary', (_name, text) => {
    expect(detectSearchesLibrary(text)).toBe(true)
    expect(detectCardMetadata(text).searchesLibrary).toBe(true)
  })

  it('Boseiju, Who Endures is not flagged — the opponent ("that player") searches, not its controller', () => {
    const text = '{T}: Add {G}.\nChannel — {1}{G}, Discard this card: Destroy target artifact, enchantment, or nonbasic land an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle. This ability costs {1} less to activate for each legendary creature you control.'
    expect(detectSearchesLibrary(text)).toBe(false)
    expect(detectCardMetadata(text, ['Channel'])).toEqual({})
  })

  it('Opposition Agent is not flagged — it punishes searching, it does not search', () => {
    const text = "Flash\nYou control your opponents while they're searching their libraries.\nWhile an opponent is searching their library, they exile each card they find. You may play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast them."
    expect(detectSearchesLibrary(text)).toBe(false)
    expect(detectCardMetadata(text, ['Flash'])).toEqual({})
  })

  it('Archivist of Oghma watches for searches but does not search, so it is tagged but not flagged', () => {
    const metadata = detectCardMetadata('Flash\nWhenever an opponent searches their library, you gain 1 life and draw a card.', ['Flash'])
    expect(metadata).toEqual({ triggerTag: { event: 'opponent-searches', effect: { kind: 'draw', count: 1 } } })
  })
})

describe('detectTriggerTag — replacement effects are not triggers (CR 614.1d)', () => {
  it('Temple of Mystery: "enters tapped" alone is excluded, but the real "When this land enters" trigger on the same card still matches', () => {
    const text = `This land enters tapped.\nWhen this land enters, scry 1. (Look at the top card of your library. You may put that card on the bottom.)\n{T}: Add {G} or {U}.`
    expect(detectTriggerTag(text)).toEqual({ event: 'permanent-etb-yours', qualifier: 'self' })
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
  it('Orcish Bowmasters matches both an ETB clause and an opponent-draws clause; opponent-draws is checked first and wins, carrying its draw-step exception', () => {
    const text = 'Flash\nWhen this creature enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, this creature deals 1 damage to any target. Then amass Orcs 1.'
    expect(detectTriggerTag(text)).toEqual({ event: 'opponent-draws', qualifier: 'not-draw-step-draw' })
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

describe('trigger effects — parsed from the trigger\'s own paragraph, verbatim Scryfall text', () => {
  const draws: [string, string, number][] = [
    ['Rhystic Study', 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.', 1],
    ['Mystic Remora', 'Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.', 1],
    ['Esper Sentinel', "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power.", 1],
    ['Faerie Mastermind', 'Flash\nFlying\nWhenever an opponent draws their second card each turn, you draw a card.\n{3}{U}: Each player draws a card.', 1],
    ['Phyrexian Arena', 'At the beginning of your upkeep, you draw a card and lose 1 life.', 1],
    ['Consecrated Sphinx', 'Flying\nWhenever an opponent draws a card, you may draw two cards.', 2],
    ['Mulldrifter', "Flying\nWhen this creature enters, draw two cards.\nEvoke {2}{U} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)", 2],
  ]

  it.each(draws)('%s -> draw %i', (_name, text, count) => {
    expect(detectTriggerTag(text)?.effect).toEqual({ kind: 'draw', count })
  })

  const treasures: [string, string][] = [
    ['Smothering Tithe', `Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")`],
    ['Gleaming Splendor', 'Whenever an opponent draws their second card each turn, you create a Treasure token.\n{2}{W}: Two target players each draw a card.'],
    ['Lotho, Corrupt Shirriff', `Whenever a player casts their second spell each turn, you lose 1 life and create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")`],
  ]

  it.each(treasures)('%s -> create 1 Treasure (name read from the text)', (_name, text) => {
    expect(detectTriggerTag(text)?.effect).toEqual({ kind: 'createToken', count: 1, tokenName: 'Treasure' })
  })

  it("another ability's draw on the same card is never taken as the trigger's effect (Gleaming Splendor's {2}{W} line)", () => {
    const text = 'Whenever an opponent draws their second card each turn, you create a Treasure token.\n{2}{W}: Two target players each draw a card.'
    expect(detectTriggerTag(text)?.effect?.kind).toBe('createToken')
  })

  it('effects the builder does not model get no effect: damage (Orcish Bowmasters), life (Blood Artist)', () => {
    const bowmasters = 'Flash\nWhen this creature enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, this creature deals 1 damage to any target. Then amass Orcs 1.'
    expect(detectTriggerTag(bowmasters)).toEqual({ event: 'opponent-draws', qualifier: 'not-draw-step-draw' })
    expect(detectTriggerTag('Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life.'))
      .toEqual({ event: 'creature-dies' })
  })

  it("draws by someone other than the trigger's controller, and uncountable draws, get no effect", () => {
    expect(detectTriggerEffect('each player draws a card.')).toBeUndefined()
    expect(detectTriggerEffect('that player draws a card.')).toBeUndefined()
    expect(detectTriggerEffect('two target players each draw a card.')).toBeUndefined()
    expect(detectTriggerEffect('draw X cards, where X is the number of artifacts you control.')).toBeUndefined()
  })
})

describe('detectCountReplacements — verbatim Scryfall text', () => {
  it("Alhammarret's Archive changes its controller's draws (and its life clause is not a draw/token replacement)", () => {
    const text = 'If you would gain life, you gain twice that much life instead.\nIf you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.'
    expect(detectCountReplacements(text)).toEqual([{ kind: 'draw', affects: 'controller' }])
  })

  it("Notion Thief changes opponents' draws", () => {
    const text = 'Flash\nIf an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card.'
    expect(detectCountReplacements(text)).toEqual([{ kind: 'draw', affects: 'opponents' }])
  })

  it('Anointed Procession ("If an effect would create ... tokens") changes its controller\'s tokens', () => {
    const text = 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.'
    expect(detectCountReplacements(text)).toEqual([{ kind: 'createToken', affects: 'controller' }])
  })

  it('Mondrak ("If one or more tokens would be created") — passive phrasing a plain "would create" pattern misses', () => {
    const text = 'If one or more tokens would be created under your control, twice that many of those tokens are created instead.\n{1}{W/P}{W/P}, Sacrifice two other artifacts and/or creatures: Put an indestructible counter on Mondrak. ({W/P} can be paid with either {W} or 2 life.)'
    expect(detectCountReplacements(text)).toEqual([{ kind: 'createToken', affects: 'controller' }])
  })

  it('Opposition Agent and Rhystic Study have none, and detectCardMetadata stores the list only when non-empty', () => {
    expect(detectCountReplacements("Flash\nYou control your opponents while they're searching their libraries.\nWhile an opponent is searching their library, they exile each card they find. You may play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast them.")).toEqual([])
    expect(detectCardMetadata('Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.')).not.toHaveProperty('countReplacements')
  })
})

describe('retagTrigger — what a context-menu re-tag keeps from the parsed tag (verbatim Scryfall text)', () => {
  const RURIC_THAR = 'Reach, vigilance\nRuric Thar attacks each combat if able.\nWhenever a player casts a noncreature spell, Ruric Thar deals 6 damage to that player.'
  const ORCISH_BOWMASTERS = 'Flash\nWhen this creature enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, this creature deals 1 damage to any target. Then amass Orcs 1.'
  const ESPER_SENTINEL = "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power."

  it('keeps the noncreature qualifier on every cast event (Ruric Thar)', () => {
    const tag = detectTriggerTag(RURIC_THAR)
    for (const event of ['any-player-casts', 'opponent-casts', 'opponent-casts-noncreature', 'you-cast-noncreature'] as const) {
      expect(retagTrigger(tag, event)).toEqual({ event, qualifier: 'noncreature' })
    }
  })

  it('keeps the draw-step exception on both draw events (Orcish Bowmasters)', () => {
    const tag = detectTriggerTag(ORCISH_BOWMASTERS)
    expect(retagTrigger(tag, 'any-player-draws')).toEqual({ event: 'any-player-draws', qualifier: 'not-draw-step-draw' })
    expect(retagTrigger(tag, 'opponent-draws')).toEqual({ event: 'opponent-draws', qualifier: 'not-draw-step-draw' })
  })

  it('drops a qualifier the new event cannot use: noncreature off a cast event, the draw-step exception off a draw event', () => {
    expect(retagTrigger(detectTriggerTag(RURIC_THAR), 'opponent-draws')).toEqual({ event: 'opponent-draws' })
    expect(retagTrigger(detectTriggerTag(RURIC_THAR), 'permanent-etb-yours')).toEqual({ event: 'permanent-etb-yours' })
    // Bowmasters' other trigger is an ETB, the likeliest re-tag for it.
    expect(retagTrigger(detectTriggerTag(ORCISH_BOWMASTERS), 'permanent-etb-yours')).toEqual({ event: 'permanent-etb-yours' })
    expect(retagTrigger(detectTriggerTag(ORCISH_BOWMASTERS), 'opponent-casts')).toEqual({ event: 'opponent-casts' })
  })

  it('keeps the effect and qualifier together and still drops the ordinal (Esper Sentinel)', () => {
    const tag = detectTriggerTag(ESPER_SENTINEL)
    expect(tag).toMatchObject({ spellNumber: 1, qualifier: 'noncreature', effect: { kind: 'draw', count: 1 } })
    expect(retagTrigger(tag, 'any-player-casts')).toEqual({ event: 'any-player-casts', qualifier: 'noncreature', effect: { kind: 'draw', count: 1 } })
    expect(retagTrigger(tag, 'opponent-draws')).toEqual({ event: 'opponent-draws', effect: { kind: 'draw', count: 1 } })
  })

  it('tagging a card that had no tag gives just the event', () => {
    expect(retagTrigger(undefined, 'your-upkeep')).toEqual({ event: 'your-upkeep' })
  })
})

describe('detectTriggerTag — an ETB about the card itself vs. one watching other permanents (verbatim Scryfall text)', () => {
  it.each([
    ['Mulldrifter', "Flying\nWhen this creature enters, draw two cards.\nEvoke {2}{U} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)"],
    ['Eternal Witness', 'When this creature enters, you may return target card from your graveyard to your hand.'],
    ["Thassa's Oracle", 'When this creature enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game. (Each {U} in the mana costs of permanents you control counts toward your devotion to blue.)'],
    // A legend names itself, sometimes by a short name.
    ['The One Ring', 'Indestructible\nWhen The One Ring enters, if you cast it, you gain protection from everything until your next turn.\nAt the beginning of your upkeep, you lose 1 life for each burden counter on The One Ring.\n{T}: Put a burden counter on The One Ring, then draw a card for each burden counter on The One Ring.'],
    ['Korvold, Fae-Cursed King', 'Flying\nWhenever Korvold enters or attacks, sacrifice another permanent.\nWhenever you sacrifice a permanent, put a +1/+1 counter on Korvold and draw a card.'],
    // Ravenous reminder text: "draw a card when it enters".
    ['Mawloc', 'Ravenous (This creature enters with X +1/+1 counters on it. If X is 5 or more, draw a card when it enters.)\nTerror from the Deep — When this creature enters, it fights up to one target creature an opponent controls. If that creature would die this turn, exile it instead.'],
  ])('%s is self-only', (_name, text) => {
    expect(detectTriggerTag(text)).toMatchObject({ event: 'permanent-etb-yours', qualifier: 'self' })
  })

  it.each([
    ['Soul Warden', 'Whenever another creature enters, you gain 1 life.'],
    ['Impact Tremors', 'Whenever a creature you control enters, this enchantment deals 1 damage to each opponent.'],
    ['Purphoros, God of the Forge', "Indestructible\nAs long as your devotion to red is less than five, Purphoros isn't a creature.\nWhenever another creature you control enters, Purphoros deals 2 damage to each opponent.\n{2}{R}: Creatures you control get +1/+0 until end of turn."],
    ['Lotus Cobra', 'Landfall — Whenever a land you control enters, add one mana of any color.'],
    ['Tome of Legends', 'This artifact enters with a page counter on it.\nWhenever your commander enters or attacks, put a page counter on this artifact.\n{1}, {T}, Remove a page counter from this artifact: Draw a card.'],
    // Fires on itself too, but also on other Allies, so it is not narrowed.
    ['Lantern Scout', 'Rally — Whenever this creature or another Ally you control enters, creatures you control gain lifelink until end of turn.'],
  ])('%s watches other permanents', (_name, text) => {
    const tag = detectTriggerTag(text)
    expect(tag?.event).toBe('permanent-etb-yours')
    expect(tag).not.toHaveProperty('qualifier')
  })

  it('a re-tag keeps self only on the ETB event (Eternal Witness)', () => {
    const tag = detectTriggerTag('When this creature enters, you may return target card from your graveyard to your hand.')
    expect(retagTrigger(tag, 'permanent-etb-yours')).toEqual({ event: 'permanent-etb-yours', qualifier: 'self' })
    expect(retagTrigger(tag, 'creature-dies')).toEqual({ event: 'creature-dies' })
  })
})
