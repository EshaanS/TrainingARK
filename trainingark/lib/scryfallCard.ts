import type { Card } from '@/types/board'
import { detectCardMetadata } from './triggerDetection'

interface ScryfallFace {
  name: string
  type_line?: string
  oracle_text?: string
  keywords?: string[]
  image_uris?: { normal?: string }
}

export interface ScryfallCard extends ScryfallFace {
  id: string
  card_faces?: ScryfallFace[]
}

export function parseCardType(typeLine: string): Card['cardType'] {
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

function matchingFace(cardData: ScryfallCard, searchedName: string): ScryfallFace | undefined {
  return cardData.card_faces?.find(f => f.name.toLowerCase().includes(searchedName.toLowerCase()))
}

// Builds a board card from a Scryfall card object. Many tokens only exist as
// one face of a double-faced token — searching "Treasure" returns
// "Dinosaur // Treasure" first — so a token takes its name, type, and text
// from the face that was searched for, not from the whole card.
export function cardFromScryfall(cardData: ScryfallCard, searchedName: string, isToken: boolean): Card {
  const face = matchingFace(cardData, searchedName)
  const tokenFace = isToken && cardData.name.includes('//') ? face : undefined
  return {
    id: cardData.id,
    name: tokenFace?.name ?? cardData.name,
    imageUrl: cardData.image_uris?.normal ?? (face ?? cardData.card_faces?.[0])?.image_uris?.normal,
    cardType: parseCardType(tokenFace?.type_line ?? cardData.type_line ?? ''),
    isToken: isToken ? true : undefined,
    ...(tokenFace
      ? detectCardMetadata(tokenFace.oracle_text)
      : detectCardMetadata(
        cardData.oracle_text ?? cardData.card_faces?.[0]?.oracle_text,
        cardData.keywords ?? cardData.card_faces?.[0]?.keywords
      )),
  }
}

// The token search behind both "Add Token" and tokens created by a resolving
// trigger. Resolves to undefined when Scryfall has no such token; rejects on a
// network failure.
export async function fetchTokenCard(name: string): Promise<Card | undefined> {
  const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(`is:token !"${name}"`)}&unique=cards`)
  if (!res.ok) return undefined
  const data = await res.json()
  const cardData: ScryfallCard | undefined = data.data?.[0]
  return cardData ? cardFromScryfall(cardData, name, true) : undefined
}
