import { afterEach, describe, expect, it, vi } from 'vitest'
import { cardFromScryfall, fetchTokenCard, type ScryfallCard } from './scryfallCard'

// Trimmed from live Scryfall responses: `is:token !"Treasure"` lists
// "Dinosaur // Treasure" first and the single-faced Treasure later.
const DINOSAUR_TREASURE: ScryfallCard = {
  id: '21f5880d-6272-4ba8-bdf8-f9a7e54a3336',
  name: 'Dinosaur // Treasure',
  type_line: 'Token Creature — Dinosaur // Token Artifact — Treasure',
  keywords: ['Trample'],
  card_faces: [
    {
      name: 'Dinosaur',
      type_line: 'Token Creature — Dinosaur',
      oracle_text: 'Trample',
      image_uris: { normal: 'https://cards.scryfall.io/normal/front/2/1/21f5880d-6272-4ba8-bdf8-f9a7e54a3336.jpg?1783936801' },
    },
    {
      name: 'Treasure',
      type_line: 'Token Artifact — Treasure',
      oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
      image_uris: { normal: 'https://cards.scryfall.io/normal/back/2/1/21f5880d-6272-4ba8-bdf8-f9a7e54a3336.jpg?1783936801' },
    },
  ],
}

const TREASURE: ScryfallCard = {
  id: '03992f88-7a15-4234-9bed-b7617d7ff09c',
  name: 'Treasure',
  type_line: 'Token Artifact — Treasure',
  oracle_text: '{T}, Sacrifice this token: Add one mana of any color.',
  keywords: [],
  image_uris: { normal: 'https://cards.scryfall.io/normal/front/0/3/03992f88-7a15-4234-9bed-b7617d7ff09c.jpg?1789735245' },
}

const DELVER: ScryfallCard = {
  id: '6904ea20-e504-47da-95a0-08739fdde260',
  name: 'Delver of Secrets // Insectile Aberration',
  type_line: 'Creature — Human Wizard // Creature — Human Insect',
  keywords: ['Flying', 'Transform'],
  card_faces: [
    {
      name: 'Delver of Secrets',
      type_line: 'Creature — Human Wizard',
      oracle_text: 'At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform this creature.',
      image_uris: { normal: 'https://cards.scryfall.io/normal/front/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg?1783908173' },
    },
    {
      name: 'Insectile Aberration',
      type_line: 'Creature — Human Insect',
      oracle_text: 'Flying',
      image_uris: { normal: 'https://cards.scryfall.io/normal/back/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg?1783908173' },
    },
  ],
}

// Trimmed from the live response. As on every double-faced card, there is no
// top-level oracle_text — only per-face text — while top-level keywords merge
// both faces ("Double strike" is Black Panther's).
const KING_TCHALLA: ScryfallCard = {
  id: 'add7d3ce-aa58-4da0-8c2a-cfd01c3a8975',
  name: "King T'Challa // Black Panther, Hope Enduring",
  type_line: 'Legendary Creature — Human Noble Hero // Legendary Creature — Human Warrior Hero',
  keywords: ['Transform', 'Double strike', 'Flash'],
  card_faces: [
    {
      name: "King T'Challa",
      type_line: 'Legendary Creature — Human Noble Hero',
      oracle_text: "Flash\nWhenever a player draws their second card each turn, you draw a card.\n{4}{W}{U}: Transform King T'Challa. Activate only as a sorcery.",
      image_uris: { normal: 'https://cards.scryfall.io/normal/front/a/d/add7d3ce-aa58-4da0-8c2a-cfd01c3a8975.jpg?1783902911' },
    },
    {
      name: 'Black Panther, Hope Enduring',
      type_line: 'Legendary Creature — Human Warrior Hero',
      oracle_text: 'Flash\nDouble strike\nPrevent all damage that would be dealt to Black Panther.\nWhenever Black Panther deals combat damage to a player, draw a card.',
      image_uris: { normal: 'https://cards.scryfall.io/normal/back/a/d/add7d3ce-aa58-4da0-8c2a-cfd01c3a8975.jpg?1783902911' },
    },
  ],
}

describe('cardFromScryfall', () => {
  it("a double-faced card is detected from its front face only (King T'Challa, not Black Panther)", () => {
    const card = cardFromScryfall(KING_TCHALLA, "King T'Challa // Black Panther, Hope Enduring", false)
    expect(card.triggerTag).toEqual({ event: 'any-player-draws', spellNumber: 2, effect: { kind: 'draw', count: 1 } })
    expect(card.imageUrl).toBe(KING_TCHALLA.card_faces![0].image_uris!.normal)
    expect(card).not.toHaveProperty('countReplacements')
  })

  it('takes a double-faced token\'s name, art, and type from the searched face, not the front (Dinosaur // Treasure)', () => {
    expect(cardFromScryfall(DINOSAUR_TREASURE, 'Treasure', true)).toEqual({
      id: DINOSAUR_TREASURE.id,
      name: 'Treasure',
      imageUrl: 'https://cards.scryfall.io/normal/back/2/1/21f5880d-6272-4ba8-bdf8-f9a7e54a3336.jpg?1783936801',
      cardType: 'artifact',
      isToken: true,
    })
  })

  it('a single-faced token is taken as is', () => {
    expect(cardFromScryfall(TREASURE, 'Treasure', true)).toMatchObject({
      name: 'Treasure', imageUrl: TREASURE.image_uris!.normal, cardType: 'artifact', isToken: true,
    })
  })

  it('a double-faced non-token card keeps its full name and front-face art and text', () => {
    const card = cardFromScryfall(DELVER, 'Delver of Secrets // Insectile Aberration', false)
    expect(card).toMatchObject({
      name: 'Delver of Secrets // Insectile Aberration',
      imageUrl: DELVER.card_faces![0].image_uris!.normal,
      cardType: 'creature',
    })
    expect(card.isToken).toBeUndefined()
  })
})

describe('fetchTokenCard', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('runs the is:token exact-name search and builds the card from its first result', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [DINOSAUR_TREASURE, TREASURE] })))
    vi.stubGlobal('fetch', fetchMock)

    const card = await fetchTokenCard('Treasure')

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent('is:token !"Treasure"')}&unique=cards`
    )
    expect(card).toMatchObject({ name: 'Treasure', cardType: 'artifact', isToken: true })
    expect(card?.imageUrl).toContain('/back/')
  })

  it('resolves to undefined when Scryfall has no such token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"object":"error"}', { status: 404 })))
    await expect(fetchTokenCard('1/1 white Soldier creature')).resolves.toBeUndefined()
  })
})
