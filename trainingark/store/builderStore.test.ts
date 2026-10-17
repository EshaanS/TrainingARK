import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBuilderStore, resolutionAlerts, discardsToHandSize, type DecisionPoint } from './builderStore'
import type { Card, TurnCounters } from '@/types/board'
import { detectCardMetadata } from '@/lib/triggerDetection'
import { fetchTokenCard } from '@/lib/scryfallCard'

// No test reaches Scryfall. By default the token lookup finds nothing, which
// leaves an effect-created token as its named tile.
vi.mock('@/lib/scryfallCard', () => ({ fetchTokenCard: vi.fn() }))
const mockFetchTokenCard = vi.mocked(fetchTokenCard)

// `history` (the undo stack) lives in a module-level variable outside the
// Zustand store, so it is not touched by `set()`/`getState()` resets. The
// store's own `resetScenario` action clears both the state fields AND that
// module-level `history` array (see builderStore.ts), so calling it before
// every test is what actually gives each test a clean slate. Resetting only
// via `setState` would leave a previous test's undo history dangling and
// bleeding into the next test's `undoLastAction` assertions.
beforeEach(() => {
  useBuilderStore.getState().resetScenario()
  mockFetchTokenCard.mockReset().mockResolvedValue(undefined)
})

function withScenarioStarted() {
  useBuilderStore.setState({ scenarioStarted: true })
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    name: 'Test Card',
    cardType: 'creature',
    ...overrides,
  }
}

describe('saveStep', () => {
  it('preserves a decisionPoint exactly as passed', () => {
    const decisionPoint: DecisionPoint = {
      prompt: 'What do you do with priority?',
      choices: [
        { id: 'c1', label: 'Cast removal', quality: 'best', explanation: 'Answers the threat now.' },
        { id: 'c2', label: 'Pass', quality: 'blunder', explanation: 'Lets the combo resolve.' },
        { id: 'c3', label: 'Counter it', quality: 'ok', explanation: 'Works but taxes your hand.' },
      ],
    }

    useBuilderStore.getState().saveStep('Decision step', decisionPoint)

    const { steps } = useBuilderStore.getState()
    expect(steps).toHaveLength(1)
    expect(steps[0].decisionPoint).toEqual(decisionPoint)
    expect(steps[0].decisionPoint?.choices).toHaveLength(3)
  })

  it('omits decisionPoint entirely when none is passed', () => {
    useBuilderStore.getState().saveStep('Plain step')
    const { steps } = useBuilderStore.getState()
    expect(steps[0]).not.toHaveProperty('decisionPoint')
  })

  it('falls back to a numbered label when label is empty', () => {
    useBuilderStore.getState().saveStep('')
    expect(useBuilderStore.getState().steps[0].label).toBe('Step 1')
  })
})

describe('moveAllCards (bulk zone movement)', () => {
  it('produces exactly one log line and one undo-able history entry for a multi-card move', () => {
    withScenarioStarted()
    const state = useBuilderStore.getState()
    const players = state.players!
    const withHand = { ...players[0], zones: { ...players[0].zones, hand: { cards: [card({ id: 'h1', name: 'A' }), card({ id: 'h2', name: 'B' }), card({ id: 'h3', name: 'C' })], revealed: false, cardCount: 3 } } }
    const updatedPlayers = [withHand, players[1], players[2], players[3]] as typeof players
    useBuilderStore.setState({ players: updatedPlayers })

    const logLinesBefore = useBuilderStore.getState().logLines.length

    useBuilderStore.getState().moveAllCards(0, 'hand', 'graveyard')

    const afterMove = useBuilderStore.getState()
    expect(afterMove.logLines.length).toBe(logLinesBefore + 1)
    expect(afterMove.players![0].zones.hand.cards).toHaveLength(0)
    expect(afterMove.players![0].zones.graveyard.cards).toHaveLength(3)

    useBuilderStore.getState().undoLastAction()

    const afterUndo = useBuilderStore.getState()
    expect(afterUndo.logLines.length).toBe(logLinesBefore)
    expect(afterUndo.players![0].zones.hand.cards).toHaveLength(3)
    expect(afterUndo.players![0].zones.graveyard.cards).toHaveLength(0)
  })

  it('materializes placeholders for the un-imported portion of a zone and grows the destination by the full count, not just the materialized array length', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    // cardCount says 10, but only 3 are actually materialized — the other 7
    // are the "un-imported" part of the library that must be represented by
    // placeholders when the whole zone is bulk-moved.
    const withLibrary = {
      ...players[0],
      zones: {
        ...players[0].zones,
        library: { cards: [card({ id: 'l1', name: 'Known1' }), card({ id: 'l2', name: 'Known2' }), card({ id: 'l3', name: 'Known3' })], revealed: false, cardCount: 10 },
      },
    }
    useBuilderStore.setState({ players: [withLibrary, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().moveAllCards(0, 'library', 'graveyard')

    const graveyard = useBuilderStore.getState().players![0].zones.graveyard
    expect(graveyard.cardCount).toBe(10)
    expect(graveyard.cards).toHaveLength(10)
    const placeholderCount = graveyard.cards.filter(c => c.name === 'Unknown card').length
    expect(placeholderCount).toBe(7)

    const library = useBuilderStore.getState().players![0].zones.library
    expect(library.cardCount).toBe(0)
    expect(library.cards).toHaveLength(0)
  })

  it('orders cards correctly for top-of-library vs bottom-of-library moves', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const existingLibraryCard = card({ id: 'z1', name: 'Z' })
    const handCards = [card({ id: 'h1', name: 'A' }), card({ id: 'h2', name: 'B' }), card({ id: 'h3', name: 'C' })]

    const setupTop = {
      ...players[0],
      zones: {
        ...players[0].zones,
        hand: { cards: handCards, revealed: false, cardCount: 3 },
        library: { cards: [existingLibraryCard], revealed: false, cardCount: 1 },
      },
    }
    useBuilderStore.setState({ players: [setupTop, players[1], players[2], players[3]] as typeof players })
    useBuilderStore.getState().moveAllCards(0, 'hand', 'library', 'top')
    // Array end = top of library, so appending to the end puts the moved
    // cards on top, in their original relative order.
    expect(useBuilderStore.getState().players![0].zones.library.cards.map(c => c.name)).toEqual(['Z', 'A', 'B', 'C'])

    useBuilderStore.getState().resetScenario()
    const setupBottom = {
      ...players[0],
      zones: {
        ...players[0].zones,
        hand: { cards: handCards, revealed: false, cardCount: 3 },
        library: { cards: [existingLibraryCard], revealed: false, cardCount: 1 },
      },
    }
    useBuilderStore.setState({ players: [setupBottom, players[1], players[2], players[3]] as typeof players })
    useBuilderStore.getState().moveAllCards(0, 'hand', 'library', 'bottom')
    // Array start = bottom of library, so the moved cards are prepended,
    // in their original relative order.
    expect(useBuilderStore.getState().players![0].zones.library.cards.map(c => c.name)).toEqual(['A', 'B', 'C', 'Z'])
  })

  it('is a no-op when the source zone is already empty', () => {
    const before = useBuilderStore.getState()
    const players = before.players!
    const emptyHand = { ...players[0], zones: { ...players[0].zones, hand: { cards: [], revealed: false, cardCount: 0 } } }
    useBuilderStore.setState({ players: [emptyHand, players[1], players[2], players[3]] as typeof players })
    const logLinesBefore = useBuilderStore.getState().logLines.length

    useBuilderStore.getState().moveAllCards(0, 'hand', 'graveyard')

    expect(useBuilderStore.getState().logLines.length).toBe(logLinesBefore)
    expect(useBuilderStore.getState().players![0].zones.graveyard.cards).toHaveLength(0)
  })
})

describe('token stacking', () => {
  it('addCard stacks a same-name token onto the existing one instead of duplicating it', () => {
    useBuilderStore.getState().addCard(0, 'battlefield', card({ id: 'tok1', name: 'Spirit', cardType: 'creature', isToken: true, stackCount: 1 }))
    useBuilderStore.getState().addCard(0, 'battlefield', card({ id: 'tok2', name: 'Spirit', cardType: 'creature', isToken: true, stackCount: 1 }))

    const battlefield = useBuilderStore.getState().players![0].zones.battlefield
    expect(battlefield.cards).toHaveLength(1)
    expect(battlefield.cards[0].stackCount).toBe(2)
    expect(battlefield.cards[0].id).toBe('tok1')
  })

  it('createTokenCopy stacks a second copy of the same source onto the first copy', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withBear = { ...players[0], zones: { ...players[0].zones, battlefield: { cards: [card({ id: 'bear1', name: 'Bear', cardType: 'creature' })], revealed: true } } }
    useBuilderStore.setState({ players: [withBear, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().createTokenCopy(0, 'bear1')
    let battlefield = useBuilderStore.getState().players![0].zones.battlefield
    expect(battlefield.cards).toHaveLength(2)
    const firstCopy = battlefield.cards.find(c => c.id !== 'bear1')!
    expect(firstCopy.isToken).toBe(true)
    expect(firstCopy.stackCount).toBe(1)

    useBuilderStore.getState().createTokenCopy(0, 'bear1')
    battlefield = useBuilderStore.getState().players![0].zones.battlefield
    expect(battlefield.cards).toHaveLength(2)
    const stackedCopy = battlefield.cards.find(c => c.id !== 'bear1')!
    expect(stackedCopy.stackCount).toBe(2)
  })

  it('incrementToken increases stackCount', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withToken = { ...players[0], zones: { ...players[0].zones, battlefield: { cards: [card({ id: 'tok1', name: 'Spirit', isToken: true, stackCount: 1 })], revealed: true } } }
    useBuilderStore.setState({ players: [withToken, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().incrementToken(0, 'tok1')
    expect(useBuilderStore.getState().players![0].zones.battlefield.cards[0].stackCount).toBe(2)
  })

  it('decrementToken decreases stackCount, and removes the card entirely at 0 rather than leaving stackCount: 0', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withToken = { ...players[0], zones: { ...players[0].zones, battlefield: { cards: [card({ id: 'tok1', name: 'Spirit', isToken: true, stackCount: 2 })], revealed: true } } }
    useBuilderStore.setState({ players: [withToken, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().decrementToken(0, 'tok1')
    let battlefield = useBuilderStore.getState().players![0].zones.battlefield
    expect(battlefield.cards).toHaveLength(1)
    expect(battlefield.cards[0].stackCount).toBe(1)

    useBuilderStore.getState().decrementToken(0, 'tok1')
    battlefield = useBuilderStore.getState().players![0].zones.battlefield
    expect(battlefield.cards).toHaveLength(0)
  })
})

describe('library/token count decoupling', () => {
  it('adding a token to the battlefield does not decrement the library count', () => {
    const libraryBefore = useBuilderStore.getState().players![0].zones.library.cardCount
    useBuilderStore.getState().addCard(0, 'battlefield', card({ id: 'tok1', name: 'Spirit', isToken: true, stackCount: 1 }))
    expect(useBuilderStore.getState().players![0].zones.library.cardCount).toBe(libraryBefore)
  })

  it('adding a real (non-token) card to a non-library zone decrements the library count', () => {
    const libraryBefore = useBuilderStore.getState().players![0].zones.library.cardCount!
    useBuilderStore.getState().addCard(0, 'hand', card({ id: 'real1', name: 'Bear' }))
    expect(useBuilderStore.getState().players![0].zones.library.cardCount).toBe(libraryBefore - 1)
  })

  it('removing a token from the battlefield does not restore the library count', () => {
    useBuilderStore.getState().addCard(0, 'battlefield', card({ id: 'tok1', name: 'Spirit', isToken: true, stackCount: 1 }))
    const libraryAfterAdd = useBuilderStore.getState().players![0].zones.library.cardCount
    useBuilderStore.getState().removeCard(0, 'tok1')
    expect(useBuilderStore.getState().players![0].zones.library.cardCount).toBe(libraryAfterAdd)
  })

  it('removing a real (non-token) card from a non-library zone restores the library count', () => {
    useBuilderStore.getState().addCard(0, 'hand', card({ id: 'real1', name: 'Bear' }))
    const libraryAfterAdd = useBuilderStore.getState().players![0].zones.library.cardCount!
    useBuilderStore.getState().removeCard(0, 'real1')
    expect(useBuilderStore.getState().players![0].zones.library.cardCount).toBe(libraryAfterAdd + 1)
  })
})

describe('removeCard', () => {
  it('removes only the targeted card, leaving another card with the same name untouched', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withDuplicates = {
      ...players[0],
      zones: {
        ...players[0].zones,
        battlefield: { cards: [card({ id: 'dup1', name: 'Sol Ring' }), card({ id: 'dup2', name: 'Sol Ring' })], revealed: true },
      },
    }
    useBuilderStore.setState({ players: [withDuplicates, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().removeCard(0, 'dup1')

    const battlefield = useBuilderStore.getState().players![0].zones.battlefield
    expect(battlefield.cards).toHaveLength(1)
    expect(battlefield.cards[0].id).toBe('dup2')
  })
})

describe('stack: castToStack / resolveStack / removeFromStack / exileFromStack', () => {
  it('"cast" removes the card from its source zone', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withHand = { ...players[0], zones: { ...players[0].zones, hand: { cards: [card({ id: 'spell1', name: 'Lightning Bolt', cardType: 'instant' })], revealed: false, cardCount: 1 } } }
    useBuilderStore.setState({ players: [withHand, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')

    expect(useBuilderStore.getState().players![0].zones.hand.cards).toHaveLength(0)
    expect(useBuilderStore.getState().stack).toHaveLength(1)
  })

  it('"triggered" and "activated" do not remove the source permanent from its zone', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withPermanent = { ...players[0], zones: { ...players[0].zones, battlefield: { cards: [card({ id: 'perm1', name: 'Bear', cardType: 'creature' })], revealed: true } } }
    useBuilderStore.setState({ players: [withPermanent, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().castToStack(0, 'perm1', 'battlefield', 'triggered')

    expect(useBuilderStore.getState().players![0].zones.battlefield.cards).toHaveLength(1)
    expect(useBuilderStore.getState().stack).toHaveLength(1)

    useBuilderStore.getState().castToStack(0, 'perm1', 'battlefield', 'activated')
    expect(useBuilderStore.getState().players![0].zones.battlefield.cards).toHaveLength(1)
    expect(useBuilderStore.getState().stack).toHaveLength(2)
  })

  it('a commander cast to the stack and resolved keeps its isCommander flag through the round trip', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const commanderCard = card({ id: 'cmdr1', name: 'Atraxa', cardType: 'creature', isCommander: true })
    const withCommand = { ...players[0], zones: { ...players[0].zones, command: { cards: [commanderCard], revealed: true } } }
    useBuilderStore.setState({ players: [withCommand, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().castToStack(0, 'cmdr1', 'command', 'cast')
    const stackItem = useBuilderStore.getState().stack[0]
    expect(stackItem.sourceCard?.isCommander).toBe(true)

    useBuilderStore.getState().resolveStack(stackItem.id)

    const battlefield = useBuilderStore.getState().players![0].zones.battlefield
    expect(battlefield.cards).toHaveLength(1)
    expect(battlefield.cards[0].isCommander).toBe(true)
    expect(battlefield.cards[0].name).toBe('Atraxa')
  })

  it('resolveStack sends non-permanent spells to the graveyard, not the battlefield', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withHand = { ...players[0], zones: { ...players[0].zones, hand: { cards: [card({ id: 'spell1', name: 'Lightning Bolt', cardType: 'instant' })], revealed: false, cardCount: 1 } } }
    useBuilderStore.setState({ players: [withHand, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')
    const stackItem = useBuilderStore.getState().stack[0]
    useBuilderStore.getState().resolveStack(stackItem.id)

    expect(useBuilderStore.getState().players![0].zones.battlefield.cards).toHaveLength(0)
    expect(useBuilderStore.getState().players![0].zones.graveyard.cards).toHaveLength(1)
  })

  it('resolving a "triggered" ability just removes it from the stack — it does not place a card anywhere', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withPermanent = { ...players[0], zones: { ...players[0].zones, battlefield: { cards: [card({ id: 'perm1', name: 'Bear', cardType: 'creature' })], revealed: true } } }
    useBuilderStore.setState({ players: [withPermanent, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().castToStack(0, 'perm1', 'battlefield', 'triggered')
    const stackItem = useBuilderStore.getState().stack[0]
    useBuilderStore.getState().resolveStack(stackItem.id)

    expect(useBuilderStore.getState().stack).toHaveLength(0)
    expect(useBuilderStore.getState().players![0].zones.battlefield.cards).toHaveLength(1)
    expect(useBuilderStore.getState().players![0].zones.graveyard.cards).toHaveLength(0)
  })

  it('removeFromStack (countered) sends the card to the graveyard', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withHand = { ...players[0], zones: { ...players[0].zones, hand: { cards: [card({ id: 'spell1', name: 'Counterspell target', cardType: 'sorcery' })], revealed: false, cardCount: 1 } } }
    useBuilderStore.setState({ players: [withHand, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')
    const stackItem = useBuilderStore.getState().stack[0]
    useBuilderStore.getState().removeFromStack(stackItem.id)

    expect(useBuilderStore.getState().stack).toHaveLength(0)
    expect(useBuilderStore.getState().players![0].zones.graveyard.cards).toHaveLength(1)
  })

  it('exileFromStack sends the card to exile', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withHand = { ...players[0], zones: { ...players[0].zones, hand: { cards: [card({ id: 'spell1', name: 'Exiled Spell', cardType: 'instant' })], revealed: false, cardCount: 1 } } }
    useBuilderStore.setState({ players: [withHand, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')
    const stackItem = useBuilderStore.getState().stack[0]
    useBuilderStore.getState().exileFromStack(stackItem.id)

    expect(useBuilderStore.getState().stack).toHaveLength(0)
    expect(useBuilderStore.getState().players![0].zones.exile.cards).toHaveLength(1)
  })
})

describe('toggleTapped / toggleRevealed', () => {
  it('toggleTapped pushes a history entry (undo works for tap actions)', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withCard = { ...players[0], zones: { ...players[0].zones, battlefield: { cards: [card({ id: 'c1', name: 'Bear', tapped: false })], revealed: true } } }
    useBuilderStore.setState({ players: [withCard, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().toggleTapped(0, 'c1')
    expect(useBuilderStore.getState().players![0].zones.battlefield.cards[0].tapped).toBe(true)

    useBuilderStore.getState().undoLastAction()
    expect(useBuilderStore.getState().players![0].zones.battlefield.cards[0].tapped).toBe(false)
  })

  it('toggleTapped produces a log line describing the new tapped state', () => {
    withScenarioStarted()
    const state = useBuilderStore.getState()
    const players = state.players!
    const withCard = { ...players[0], zones: { ...players[0].zones, battlefield: { cards: [card({ id: 'c1', name: 'Bear', tapped: false })], revealed: true } } }
    useBuilderStore.setState({ players: [withCard, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().toggleTapped(0, 'c1')
    const lines = useBuilderStore.getState().logLines
    expect(lines[lines.length - 1]).toBe("Player's Bear is tapped.")
  })

  it('toggleRevealed on the local player (index 0) is a guarded no-op and adds no history entry', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withCard = { ...players[0], zones: { ...players[0].zones, battlefield: { cards: [card({ id: 'c1', name: 'Bear', revealed: false })], revealed: true } } }
    useBuilderStore.setState({ players: [withCard, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().toggleRevealed(0, 'c1')
    expect(useBuilderStore.getState().players![0].zones.battlefield.cards[0].revealed).toBe(false)

    // If a history entry had leaked in, undo would have something to revert
    // to (and, since nothing changed, it would be a silent no-op either way)
    // — assert directly against the module-level guard instead by checking
    // the state is untouched.
    useBuilderStore.getState().undoLastAction()
    expect(useBuilderStore.getState().players![0].zones.battlefield.cards[0].revealed).toBe(false)
  })

  it('toggleRevealed on an opponent seat toggles the flag and pushes history', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withCard = { ...players[1], zones: { ...players[1].zones, battlefield: { cards: [card({ id: 'c1', name: 'Bear', revealed: false })], revealed: true } } }
    useBuilderStore.setState({ players: [players[0], withCard, players[2], players[3]] as typeof players })

    useBuilderStore.getState().toggleRevealed(1, 'c1')
    expect(useBuilderStore.getState().players![1].zones.battlefield.cards[0].revealed).toBe(true)

    useBuilderStore.getState().undoLastAction()
    expect(useBuilderStore.getState().players![1].zones.battlefield.cards[0].revealed).toBe(false)
  })
})

describe('moveCard', () => {
  it('resets tapped to false when a card changes zones', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const withCard = { ...players[0], zones: { ...players[0].zones, battlefield: { cards: [card({ id: 'c1', name: 'Bear', tapped: true })], revealed: true } } }
    useBuilderStore.setState({ players: [withCard, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().moveCard(0, 'c1', 'battlefield', 'graveyard')

    expect(useBuilderStore.getState().players![0].zones.graveyard.cards[0].tapped).toBe(false)
  })

  it('places a single card on top vs bottom of the library correctly', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const existingLibraryCard = card({ id: 'z1', name: 'Z' })
    const setup = {
      ...players[0],
      zones: {
        ...players[0].zones,
        hand: { cards: [card({ id: 'h1', name: 'A' })], revealed: false, cardCount: 1 },
        library: { cards: [existingLibraryCard], revealed: false, cardCount: 1 },
      },
    }
    useBuilderStore.setState({ players: [setup, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().moveCard(0, 'h1', 'hand', 'library', 'top')
    expect(useBuilderStore.getState().players![0].zones.library.cards.map(c => c.name)).toEqual(['Z', 'A'])

    useBuilderStore.getState().resetScenario()
    useBuilderStore.setState({ players: [setup, players[1], players[2], players[3]] as typeof players })
    useBuilderStore.getState().moveCard(0, 'h1', 'hand', 'library', 'bottom')
    expect(useBuilderStore.getState().players![0].zones.library.cards.map(c => c.name)).toEqual(['A', 'Z'])
  })
})

describe('drawCard', () => {
  it('falls back to a placeholder card when the library has a cardCount but no materialized cards', () => {
    // Default fresh player: library.cardCount === 99, library.cards === [].
    useBuilderStore.getState().drawCard(0)

    const stateAfter = useBuilderStore.getState()
    expect(stateAfter.players![0].zones.library.cardCount).toBe(98)
    expect(stateAfter.players![0].zones.library.cards).toHaveLength(0)
    expect(stateAfter.players![0].zones.hand.cards).toHaveLength(1)
    expect(stateAfter.players![0].zones.hand.cards[0].faceDown).toBe(true)
  })

  it('draws the materialized top card (end of array) when the library is populated', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const setup = {
      ...players[0],
      zones: { ...players[0].zones, library: { cards: [card({ id: 'bottom', name: 'Bottom' }), card({ id: 'top', name: 'Top' })], revealed: false, cardCount: 2 } },
    }
    useBuilderStore.setState({ players: [setup, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().drawCard(0)

    const stateAfter = useBuilderStore.getState()
    expect(stateAfter.players![0].zones.hand.cards[0].name).toBe('Top')
    expect(stateAfter.players![0].zones.library.cards.map(c => c.name)).toEqual(['Bottom'])
    expect(stateAfter.players![0].zones.library.cardCount).toBe(1)
  })

  it('is a no-op when the library is fully empty', () => {
    const state = useBuilderStore.getState()
    const players = state.players!
    const setup = { ...players[0], zones: { ...players[0].zones, library: { cards: [], revealed: false, cardCount: 0 } } }
    useBuilderStore.setState({ players: [setup, players[1], players[2], players[3]] as typeof players })

    useBuilderStore.getState().drawCard(0)

    expect(useBuilderStore.getState().players![0].zones.hand.cards).toHaveLength(0)
  })
})

describe('addCard / silentAddCard to the library zone itself', () => {
  it('addCard(zone="library") actually adds the card instead of being silently dropped', () => {
    useBuilderStore.getState().addCard(0, 'library', card({ id: 'new1', name: 'Fresh draw' }))
    const library = useBuilderStore.getState().players![0].zones.library
    expect(library.cards.map(c => c.id)).toContain('new1')
  })

  it('silentAddCard(zone="library") actually adds the card, and adds no history/log entries', () => {
    const logLinesBefore = useBuilderStore.getState().logLines.length
    useBuilderStore.getState().silentAddCard(0, 'library', card({ id: 'new1', name: 'Fresh draw' }))

    const stateAfter = useBuilderStore.getState()
    expect(stateAfter.players![0].zones.library.cards.map(c => c.id)).toContain('new1')
    expect(stateAfter.logLines.length).toBe(logLinesBefore)

    // No history entry should have been pushed either.
    useBuilderStore.getState().undoLastAction()
    expect(useBuilderStore.getState().players![0].zones.library.cards.map(c => c.id)).toContain('new1')
  })
})

describe('undoLastAction', () => {
  it('is a safe no-op when there is no history', () => {
    expect(() => useBuilderStore.getState().undoLastAction()).not.toThrow()
  })

  it('restores players, stack, and logLines together from a single prior action', () => {
    withScenarioStarted()
    const state = useBuilderStore.getState()
    const players = state.players!
    const withHand = { ...players[0], zones: { ...players[0].zones, hand: { cards: [card({ id: 'spell1', name: 'Lightning Bolt', cardType: 'instant' })], revealed: false, cardCount: 1 } } }
    useBuilderStore.setState({ players: [withHand, players[1], players[2], players[3]] as typeof players })

    const playersBefore = useBuilderStore.getState().players
    const stackBefore = useBuilderStore.getState().stack
    const logLinesBefore = useBuilderStore.getState().logLines

    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')

    expect(useBuilderStore.getState().players).not.toEqual(playersBefore)
    expect(useBuilderStore.getState().stack).not.toEqual(stackBefore)
    expect(useBuilderStore.getState().logLines).not.toEqual(logLinesBefore)

    useBuilderStore.getState().undoLastAction()

    expect(useBuilderStore.getState().players).toEqual(playersBefore)
    expect(useBuilderStore.getState().stack).toEqual(stackBefore)
    expect(useBuilderStore.getState().logLines).toEqual(logLinesBefore)
  })
})

function withHandCards(playerIndex: 0 | 1 | 2 | 3, cards: Card[]) {
  const players = useBuilderStore.getState().players!
  const updated = [...players] as typeof players
  updated[playerIndex] = {
    ...players[playerIndex],
    zones: { ...players[playerIndex].zones, hand: { cards, revealed: false, cardCount: cards.length } },
  }
  useBuilderStore.setState({ players: updated })
}

function withBattlefieldCards(playerIndex: 0 | 1 | 2 | 3, cards: Card[]) {
  const players = useBuilderStore.getState().players!
  const updated = [...players] as typeof players
  updated[playerIndex] = {
    ...players[playerIndex],
    zones: { ...players[playerIndex].zones, battlefield: { cards, revealed: true } },
  }
  useBuilderStore.setState({ players: updated })
}

describe('turn counters: auto-increment on cast/draw, reset on passTurn', () => {
  it('does not increment counters or create a prompt while the scenario has not started', () => {
    withHandCards(0, [card({ id: 'spell1', name: 'Lightning Bolt', cardType: 'instant' })])
    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')

    const { turnCounters, pendingTriggerPrompt } = useBuilderStore.getState()
    expect(turnCounters.spellsCastThisTurn).toEqual([0, 0, 0, 0])
    expect(turnCounters.totalSpellsCastThisTurn).toBe(0)
    expect(pendingTriggerPrompt).toBeNull()
  })

  it('increments spellsCastThisTurn and totalSpellsCastThisTurn on a real cast once the scenario has started', () => {
    withScenarioStarted()
    withHandCards(0, [card({ id: 'spell1', name: 'Lightning Bolt', cardType: 'instant' })])
    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')

    const { turnCounters } = useBuilderStore.getState()
    expect(turnCounters.spellsCastThisTurn[0]).toBe(1)
    expect(turnCounters.totalSpellsCastThisTurn).toBe(1)
  })

  it('does not touch spell counters for "triggered"/"activated" castToStack calls', () => {
    withScenarioStarted()
    withBattlefieldCards(0, [card({ id: 'perm1', name: 'Bear', cardType: 'creature' })])
    useBuilderStore.getState().castToStack(0, 'perm1', 'battlefield', 'triggered')

    expect(useBuilderStore.getState().turnCounters.totalSpellsCastThisTurn).toBe(0)
  })

  it('increments cardsDrawnThisTurn on drawCard once the scenario has started, not before', () => {
    withHandCards(0, [])
    const players = useBuilderStore.getState().players!
    const updated = [...players] as typeof players
    updated[0] = { ...players[0], zones: { ...players[0].zones, library: { cards: [card({ id: 'lib1', name: 'Island', cardType: 'land' }), card({ id: 'lib2', name: 'Forest', cardType: 'land' })], revealed: false, cardCount: 2 } } }
    useBuilderStore.setState({ players: updated })

    useBuilderStore.getState().drawCard(0)
    expect(useBuilderStore.getState().turnCounters.cardsDrawnThisTurn[0]).toBe(0)

    withScenarioStarted()
    useBuilderStore.getState().drawCard(0)
    expect(useBuilderStore.getState().turnCounters.cardsDrawnThisTurn[0]).toBe(1)
  })

  it('passTurn resets every counter to zero for every player, land drops included', () => {
    withScenarioStarted()
    useBuilderStore.setState({
      turnCounters: { spellsCastThisTurn: [3, 1, 0, 2], totalSpellsCastThisTurn: 6, cardsDrawnThisTurn: [2, 0, 1, 0], landDropsThisTurn: [1, 0, 2, 0] },
    })

    useBuilderStore.getState().passTurn()

    expect(useBuilderStore.getState().turnCounters).toEqual({
      spellsCastThisTurn: [0, 0, 0, 0],
      totalSpellsCastThisTurn: 0,
      cardsDrawnThisTurn: [0, 0, 0, 0],
      landDropsThisTurn: [0, 0, 0, 0],
    })
  })
})

describe('pending trigger prompts', () => {
  it('creates a prompt when an opponent casts a spell with a matching watcher on the battlefield', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [card({ id: 'watcher1', name: 'Rhystic Study', cardType: 'enchantment', triggerTag: { event: 'opponent-casts' } })])
    withHandCards(0, [card({ id: 'spell1', name: 'Lightning Bolt', cardType: 'instant' })])

    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')

    const prompt = useBuilderStore.getState().pendingTriggerPrompt
    expect(prompt?.triggers).toHaveLength(1)
    expect(prompt?.triggers[0].sourceCard.name).toBe('Rhystic Study')
    expect(prompt?.triggers[0].event).toBe('opponent-casts')
  })

  it('merges a single matched event into one combined prompt when a noncreature cast matches two different tag categories', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [
      card({ id: 'watcher1', name: 'Rhystic Study', cardType: 'enchantment', triggerTag: { event: 'opponent-casts' } }),
      card({ id: 'watcher2', name: 'Mystic Remora', cardType: 'enchantment', triggerTag: { event: 'opponent-casts-noncreature', qualifier: 'noncreature' } }),
    ])
    withHandCards(0, [card({ id: 'spell1', name: 'Lightning Bolt', cardType: 'instant' })])

    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')

    const prompt = useBuilderStore.getState().pendingTriggerPrompt
    expect(prompt?.triggers.map(t => t.sourceCard.name).sort()).toEqual(['Mystic Remora', 'Rhystic Study'])
  })

  it('does not offer a noncreature-only watcher when the cast spell is a creature', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [card({ id: 'watcher2', name: 'Mystic Remora', cardType: 'enchantment', triggerTag: { event: 'opponent-casts-noncreature', qualifier: 'noncreature' } })])
    withHandCards(0, [card({ id: 'spell1', name: 'Bear', cardType: 'creature' })])

    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')

    expect(useBuilderStore.getState().pendingTriggerPrompt).toBeNull()
  })

  it('acceptPendingTriggers pushes a "triggered" item above the spell and clears the prompt', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [card({ id: 'watcher1', name: 'Rhystic Study', cardType: 'enchantment', triggerTag: { event: 'opponent-casts' } })])
    withHandCards(0, [card({ id: 'spell1', name: 'Lightning Bolt', cardType: 'instant' })])
    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')

    useBuilderStore.getState().acceptPendingTriggers()

    const stack = useBuilderStore.getState().stack
    expect(stack).toHaveLength(2)
    expect(stack[1].sourceCardName).toBe('Rhystic Study')
    expect(stack[1].type).toBe('triggered')
    expect(useBuilderStore.getState().pendingTriggerPrompt).toBeNull()
  })

  it('dismissPendingTriggers clears the prompt without touching the stack', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [card({ id: 'watcher1', name: 'Rhystic Study', cardType: 'enchantment', triggerTag: { event: 'opponent-casts' } })])
    withHandCards(0, [card({ id: 'spell1', name: 'Lightning Bolt', cardType: 'instant' })])
    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')

    useBuilderStore.getState().dismissPendingTriggers()

    expect(useBuilderStore.getState().stack).toHaveLength(1)
    expect(useBuilderStore.getState().pendingTriggerPrompt).toBeNull()
  })

  it('remembers an ordering preference the first time two triggers match the same event, and reuses it without asking again', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [
      card({ id: 'watcherA', name: 'WatcherA', cardType: 'enchantment', triggerTag: { event: 'opponent-casts' } }),
      card({ id: 'watcherB', name: 'WatcherB', cardType: 'enchantment', triggerTag: { event: 'opponent-casts' } }),
    ])
    withHandCards(0, [
      card({ id: 'spell1', name: 'Bolt1', cardType: 'instant' }),
      card({ id: 'spell2', name: 'Bolt2', cardType: 'instant' }),
    ])

    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')
    expect(useBuilderStore.getState().pendingTriggerPrompt?.triggers).toHaveLength(2)
    useBuilderStore.getState().acceptPendingTriggers('first-listed-first')

    expect(useBuilderStore.getState().triggerStackOrder).toBe('first-listed-first')
    let stack = useBuilderStore.getState().stack
    expect(stack[stack.length - 1].sourceCardName).toBe('WatcherA')
    expect(stack[stack.length - 2].sourceCardName).toBe('WatcherB')

    // Second multi-trigger prompt: no explicit order passed this time — the
    // remembered preference from the first prompt must still apply.
    useBuilderStore.getState().castToStack(0, 'spell2', 'hand', 'cast')
    expect(useBuilderStore.getState().pendingTriggerPrompt?.triggers).toHaveLength(2)
    useBuilderStore.getState().acceptPendingTriggers()

    stack = useBuilderStore.getState().stack
    expect(stack[stack.length - 1].sourceCardName).toBe('WatcherA')
    expect(stack[stack.length - 2].sourceCardName).toBe('WatcherB')
  })

  it('merges a second triggering action into an already-pending prompt instead of overwriting it', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [
      card({ id: 'watcherCast', name: 'WatcherCast', cardType: 'enchantment', triggerTag: { event: 'opponent-casts' } }),
      card({ id: 'watcherDraw', name: 'WatcherDraw', cardType: 'enchantment', triggerTag: { event: 'opponent-draws' } }),
    ])
    withHandCards(0, [card({ id: 'spell1', name: 'Bolt1', cardType: 'instant' })])
    const players = useBuilderStore.getState().players!
    const updated = [...players] as typeof players
    updated[0] = { ...updated[0], zones: { ...updated[0].zones, library: { cards: [card({ id: 'lib1', name: 'Island', cardType: 'land' })], revealed: false, cardCount: 1 } } }
    useBuilderStore.setState({ players: updated })

    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')
    expect(useBuilderStore.getState().pendingTriggerPrompt?.triggers).toHaveLength(1)

    useBuilderStore.getState().drawCard(0)

    const prompt = useBuilderStore.getState().pendingTriggerPrompt
    expect(prompt?.triggers.map(t => t.sourceCard.name).sort()).toEqual(['WatcherCast', 'WatcherDraw'])
  })
})

describe('storm', () => {
  it('locks the storm copy count to the number of spells cast BEFORE the storm spell, excluding itself', () => {
    withScenarioStarted()
    withHandCards(0, [
      card({ id: 'bolt1', name: 'Bolt1', cardType: 'instant' }),
      card({ id: 'bolt2', name: 'Bolt2', cardType: 'instant' }),
      card({ id: 'storm1', name: 'Grapeshot', cardType: 'instant', hasStorm: true }),
    ])

    useBuilderStore.getState().castToStack(0, 'bolt1', 'hand', 'cast')
    useBuilderStore.getState().castToStack(0, 'bolt2', 'hand', 'cast')
    useBuilderStore.getState().castToStack(0, 'storm1', 'hand', 'cast')

    const stack = useBuilderStore.getState().stack
    expect(stack).toHaveLength(4)
    const stormTrigger = stack[3]
    expect(stormTrigger.sourceCardName).toBe('Grapeshot')
    expect(stormTrigger.stormCopyCount).toBe(2)
    expect(useBuilderStore.getState().turnCounters.totalSpellsCastThisTurn).toBe(3)
  })

  it('also triggers storm when a battlefield permanent grants it to the cast card\'s type', () => {
    withScenarioStarted()
    withBattlefieldCards(0, [card({ id: 'granter', name: 'Prismari, the Inspiration', cardType: 'enchantment', grantsStorm: { toTypes: ['instant', 'sorcery'] } })])
    withHandCards(0, [card({ id: 'bolt1', name: 'Shock', cardType: 'instant' })])

    useBuilderStore.getState().castToStack(0, 'bolt1', 'hand', 'cast')

    const stack = useBuilderStore.getState().stack
    expect(stack).toHaveLength(2)
    expect(stack[1].stormCopyCount).toBe(0)
  })

  it('resolving the storm trigger fans out into N separate isStormCopy stack items, not one grouped item', () => {
    withScenarioStarted()
    const sourceCard = card({ id: 'storm1', name: 'Grapeshot', cardType: 'instant', hasStorm: true })
    const stormTrigger = {
      id: 'storm-trigger-1', sourceCardId: 'storm1', sourceCardName: 'Grapeshot', controller: 'Player',
      label: 'Grapeshot', type: 'triggered' as const, cardType: 'instant' as const, sourceCard, stormCopyCount: 2,
    }
    useBuilderStore.setState({ stack: [stormTrigger] })

    useBuilderStore.getState().resolveStack('storm-trigger-1')

    const stack = useBuilderStore.getState().stack
    const copies = stack.filter(s => s.isStormCopy)
    expect(copies).toHaveLength(2)
    expect(copies[0].id).not.toBe(copies[1].id)
    expect(copies.every(c => c.sourceCardName === 'Grapeshot')).toBe(true)
  })

  function makeStormCopy(id: string) {
    return { id, sourceCardId: 'storm1', sourceCardName: 'Grapeshot', controller: 'Player', label: 'Grapeshot', type: 'cast' as const, cardType: 'instant' as const, isStormCopy: true }
  }

  it('a resolved storm copy ceases to exist without landing in a zone', () => {
    withScenarioStarted()
    useBuilderStore.setState({ stack: [makeStormCopy('copy-1')] })
    useBuilderStore.getState().resolveStack('copy-1')
    expect(useBuilderStore.getState().stack).toHaveLength(0)
    expect(useBuilderStore.getState().players![0].zones.battlefield.cards).toHaveLength(0)
    expect(useBuilderStore.getState().players![0].zones.graveyard.cards).toHaveLength(0)
  })

  it('a countered storm copy ceases to exist without landing in the graveyard', () => {
    withScenarioStarted()
    useBuilderStore.setState({ stack: [makeStormCopy('copy-2')] })
    useBuilderStore.getState().removeFromStack('copy-2')
    expect(useBuilderStore.getState().stack).toHaveLength(0)
    expect(useBuilderStore.getState().players![0].zones.graveyard.cards).toHaveLength(0)
  })

  it('an exiled storm copy ceases to exist without landing in exile', () => {
    withScenarioStarted()
    useBuilderStore.setState({ stack: [makeStormCopy('copy-3')] })
    useBuilderStore.getState().exileFromStack('copy-3')
    expect(useBuilderStore.getState().stack).toHaveLength(0)
    expect(useBuilderStore.getState().players![0].zones.exile.cards).toHaveLength(0)
  })
})

describe('doesNotUntap / setTriggerTag', () => {
  it('toggleDoesNotUntap only affects a card on the battlefield', () => {
    withBattlefieldCards(0, [card({ id: 'vault1', name: 'Mana Vault', cardType: 'artifact' })])

    useBuilderStore.getState().toggleDoesNotUntap(0, 'vault1')
    expect(useBuilderStore.getState().players![0].zones.battlefield.cards[0].doesNotUntap).toBe(true)

    useBuilderStore.getState().toggleDoesNotUntap(0, 'vault1')
    expect(useBuilderStore.getState().players![0].zones.battlefield.cards[0].doesNotUntap).toBe(false)
  })

  it('toggleDoesNotUntap is a no-op for a card that is not on the battlefield', () => {
    withHandCards(0, [card({ id: 'vault1', name: 'Mana Vault', cardType: 'artifact' })])
    const before = useBuilderStore.getState().players

    useBuilderStore.getState().toggleDoesNotUntap(0, 'vault1')

    expect(useBuilderStore.getState().players).toEqual(before)
  })

  it('setTriggerTag sets and clears a tag on a card in any zone', () => {
    withHandCards(0, [card({ id: 'card1', name: 'Mulldrifter', cardType: 'creature' })])

    useBuilderStore.getState().setTriggerTag(0, 'card1', { event: 'permanent-etb-yours' })
    expect(useBuilderStore.getState().players![0].zones.hand.cards[0].triggerTag).toEqual({ event: 'permanent-etb-yours' })

    useBuilderStore.getState().setTriggerTag(0, 'card1', undefined)
    expect(useBuilderStore.getState().players![0].zones.hand.cards[0].triggerTag).toBeUndefined()
  })
})

describe('opponent-searches fires when the searching object resolves, not when it goes on the stack', () => {
  const archivist = () => card({ id: 'archivist', name: 'Archivist of Oghma', cardType: 'creature', triggerTag: { event: 'opponent-searches' } })
  const stack = () => useBuilderStore.getState().stack
  const prompt = () => useBuilderStore.getState().pendingTriggerPrompt
  const resolveTop = () => useBuilderStore.getState().resolveStack(stack().at(-1)!.id)

  it('cast path: casting a tutor offers nothing; resolving it offers the opposing Archivist, whose trigger lands after the tutor has left the stack', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [archivist()])
    withHandCards(0, [card({ id: 'tutor', name: 'Demonic Tutor', cardType: 'sorcery', searchesLibrary: true })])

    useBuilderStore.getState().castToStack(0, 'tutor', 'hand', 'cast')
    expect(prompt()).toBeNull()
    expect(stack().map(s => s.sourceCardName)).toEqual(['Demonic Tutor'])

    resolveTop()
    expect(prompt()?.triggers).toHaveLength(1)
    expect(prompt()?.triggers[0].sourceCard.name).toBe('Archivist of Oghma')
    expect(prompt()?.triggers[0].event).toBe('opponent-searches')
    expect(useBuilderStore.getState().players![0].zones.graveyard.cards.map(c => c.name)).toEqual(['Demonic Tutor'])

    useBuilderStore.getState().acceptPendingTriggers()
    expect(stack().map(s => `${s.sourceCardName}:${s.type}`)).toEqual(['Archivist of Oghma:triggered'])
  })

  it('cast path: a tutor offers cast-event watchers at cast time and opponent-searches only at resolution', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [
      archivist(),
      card({ id: 'rhystic', name: 'Rhystic Study', cardType: 'enchantment', triggerTag: { event: 'opponent-casts' } }),
    ])
    withHandCards(0, [card({ id: 'tutor', name: 'Vampiric Tutor', cardType: 'instant', searchesLibrary: true })])

    useBuilderStore.getState().castToStack(0, 'tutor', 'hand', 'cast')
    expect(prompt()?.triggers.map(t => t.event)).toEqual(['opponent-casts'])
    useBuilderStore.getState().dismissPendingTriggers()

    resolveTop()
    expect(prompt()?.triggers.map(t => t.event)).toEqual(['opponent-searches'])
  })

  it('cast path: a spell without searchesLibrary offers nothing when it resolves', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [archivist()])
    withHandCards(0, [card({ id: 'spell1', name: 'Lightning Bolt', cardType: 'instant' })])

    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')
    resolveTop()

    expect(prompt()).toBeNull()
  })

  it('a countered tutor never searches, so it offers nothing', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [archivist()])
    withHandCards(0, [card({ id: 'tutor', name: 'Demonic Tutor', cardType: 'sorcery', searchesLibrary: true })])

    useBuilderStore.getState().castToStack(0, 'tutor', 'hand', 'cast')
    useBuilderStore.getState().removeFromStack(stack().at(-1)!.id)

    expect(prompt()).toBeNull()
  })

  it('activated path: activating a fetch land offers nothing; resolving the ability through the ability branch offers the opposing Archivist', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [archivist()])
    withBattlefieldCards(0, [card({ id: 'tarn', name: 'Scalding Tarn', cardType: 'land', searchesLibrary: true })])
    const countersBefore = useBuilderStore.getState().turnCounters

    useBuilderStore.getState().castToStack(0, 'tarn', 'battlefield', 'activated')
    expect(prompt()).toBeNull()
    expect(stack().at(-1)?.type).toBe('activated')
    expect(useBuilderStore.getState().players![0].zones.battlefield.cards.map(c => c.id)).toEqual(['tarn'])
    expect(useBuilderStore.getState().turnCounters).toEqual(countersBefore)

    resolveTop()
    expect(stack()).toHaveLength(0)
    expect(prompt()?.triggers).toHaveLength(1)
    expect(prompt()?.triggers[0].sourceCard.name).toBe('Archivist of Oghma')
    expect(useBuilderStore.getState().logLines.at(-1)).toMatch(/ability resolves/)
  })

  it('activated path: a permanent without searchesLibrary offers nothing when its ability resolves', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [archivist()])
    withBattlefieldCards(0, [card({ id: 'boseiju', name: 'Boseiju, Who Endures', cardType: 'land' })])

    useBuilderStore.getState().castToStack(0, 'boseiju', 'battlefield', 'activated')
    resolveTop()

    expect(prompt()).toBeNull()
  })

  it('"when this enters, search" creature: resolving the creature offers only its own ETB; resolving that ETB trigger offers Archivist', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [archivist()])
    withHandCards(0, [card({ id: 'searcher', name: 'ETB Search Creature', cardType: 'creature', searchesLibrary: true, triggerTag: { event: 'permanent-etb-yours' } })])

    useBuilderStore.getState().castToStack(0, 'searcher', 'hand', 'cast')
    expect(prompt()).toBeNull()

    resolveTop()
    expect(prompt()?.triggers.map(t => `${t.sourceCard.name}:${t.event}`)).toEqual(['ETB Search Creature:permanent-etb-yours'])

    useBuilderStore.getState().acceptPendingTriggers()
    expect(prompt()).toBeNull()
    resolveTop()
    expect(prompt()?.triggers.map(t => `${t.sourceCard.name}:${t.event}`)).toEqual(['Archivist of Oghma:opponent-searches'])
  })

  it('a storm copy of a tutor offers Archivist as it resolves; the storm trigger itself does not', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [archivist()])
    withBattlefieldCards(0, [card({ id: 'granter', name: 'Storm Granter', cardType: 'enchantment', grantsStorm: { toTypes: ['sorcery'] } })])
    withHandCards(0, [
      card({ id: 'spell1', name: 'Lightning Bolt', cardType: 'instant' }),
      card({ id: 'tutor', name: 'Demonic Tutor', cardType: 'sorcery', searchesLibrary: true }),
    ])

    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')
    useBuilderStore.getState().castToStack(0, 'tutor', 'hand', 'cast')
    expect(stack().at(-1)?.stormCopyCount).toBe(1)

    resolveTop()
    expect(prompt()).toBeNull()
    expect(stack().at(-1)?.isStormCopy).toBe(true)

    resolveTop()
    expect(prompt()?.triggers.map(t => t.sourceCard.name)).toEqual(['Archivist of Oghma'])
  })

  it('does not offer Archivist when its own controller searches (it watches opponents)', () => {
    withScenarioStarted()
    withBattlefieldCards(0, [archivist(), card({ id: 'tarn', name: 'Scalding Tarn', cardType: 'land', searchesLibrary: true })])

    useBuilderStore.getState().castToStack(0, 'tarn', 'battlefield', 'activated')
    resolveTop()

    expect(prompt()).toBeNull()
  })

  it('offers nothing during setup, on either path', () => {
    withBattlefieldCards(1, [archivist()])
    withBattlefieldCards(0, [card({ id: 'tarn', name: 'Scalding Tarn', cardType: 'land', searchesLibrary: true })])
    withHandCards(0, [card({ id: 'tutor', name: 'Demonic Tutor', cardType: 'sorcery', searchesLibrary: true })])

    useBuilderStore.getState().castToStack(0, 'tarn', 'battlefield', 'activated')
    useBuilderStore.getState().castToStack(0, 'tutor', 'hand', 'cast')
    resolveTop()
    resolveTop()

    expect(stack()).toHaveLength(0)
    expect(prompt()).toBeNull()
  })
})

function withLibrary(playerIndex: 0 | 1 | 2 | 3, count: number) {
  const players = useBuilderStore.getState().players!
  const updated = [...players] as typeof players
  const cards = Array.from({ length: count }, (_, i) => card({ id: `lib-${playerIndex}-${i}`, name: 'Island', cardType: 'land' }))
  updated[playerIndex] = { ...updated[playerIndex], zones: { ...updated[playerIndex].zones, library: { cards, revealed: false, cardCount: count } } }
  useBuilderStore.setState({ players: updated })
}

describe('second-card-each-turn draw triggers, end to end from real oracle text', () => {
  // Verbatim Scryfall oracle text.
  const FAERIE_MASTERMIND = 'Flash\nFlying\nWhenever an opponent draws their second card each turn, you draw a card.\n{3}{U}: Each player draws a card.'
  const GLEAMING_SPLENDOR = 'Whenever an opponent draws their second card each turn, you create a Treasure token.\n{2}{W}: Two target players each draw a card.'

  it.each([
    ['Faerie Mastermind', FAERIE_MASTERMIND],
    ['Gleaming Splendor', GLEAMING_SPLENDOR],
  ])('%s does not fire on an opponent\'s first draw of the turn and does fire on their second', (name, oracleText) => {
    withScenarioStarted()
    withBattlefieldCards(1, [card({ id: 'watcher', name, cardType: 'enchantment', ...detectCardMetadata(oracleText) })])
    withLibrary(0, 3)

    useBuilderStore.getState().drawCard(0)
    expect(useBuilderStore.getState().pendingTriggerPrompt).toBeNull()

    useBuilderStore.getState().drawCard(0)
    expect(useBuilderStore.getState().pendingTriggerPrompt?.triggers.map(t => t.sourceCard.name)).toEqual([name])
  })

  it('counts draws per player: another opponent\'s first draw does not advance the first opponent toward "second card"', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [card({ id: 'watcher', name: 'Faerie Mastermind', cardType: 'creature', ...detectCardMetadata(FAERIE_MASTERMIND) })])
    withLibrary(0, 3)
    withLibrary(2, 3)

    useBuilderStore.getState().drawCard(0)
    useBuilderStore.getState().drawCard(2)
    expect(useBuilderStore.getState().pendingTriggerPrompt).toBeNull()
  })

  it('does not fire again on a third draw', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [card({ id: 'watcher', name: 'Gleaming Splendor', cardType: 'enchantment', ...detectCardMetadata(GLEAMING_SPLENDOR) })])
    withLibrary(0, 3)

    useBuilderStore.getState().drawCard(0)
    useBuilderStore.getState().drawCard(0)
    useBuilderStore.getState().dismissPendingTriggers()
    useBuilderStore.getState().drawCard(0)
    expect(useBuilderStore.getState().pendingTriggerPrompt).toBeNull()
  })
})

describe('"a player" triggers fire on every player\'s draws and casts, including the controller\'s own', () => {
  // Verbatim Scryfall oracle text (King T'Challa is the front face of a DFC).
  const KING_TCHALLA = "Flash\nWhenever a player draws their second card each turn, you draw a card.\n{4}{W}{U}: Transform King T'Challa. Activate only as a sorcery."
  const LOTHO = `Whenever a player casts their second spell each turn, you lose 1 life and create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")`
  const RURIC_THAR = 'Reach, vigilance\nRuric Thar attacks each combat if able.\nWhenever a player casts a noncreature spell, Ruric Thar deals 6 damage to that player.'

  const state = () => useBuilderStore.getState()
  const promptedNames = () => state().pendingTriggerPrompt?.triggers.map(t => t.sourceCard.name)
  const handCount = (playerIndex: number) => state().players![playerIndex].zones.hand.cardCount ?? 0

  function withTChalla() {
    withScenarioStarted()
    withBattlefieldCards(1, [card({ id: 'tchalla', name: "King T'Challa", cardType: 'creature', ...detectCardMetadata(KING_TCHALLA) })])
    withLibrary(0, 5)
    withLibrary(1, 5)
  }

  it("King T'Challa fires on its controller's own second draw, and resolving draws a third card without firing again", () => {
    withTChalla()

    state().drawCard(1)
    expect(state().pendingTriggerPrompt).toBeNull()
    state().drawCard(1)
    expect(promptedNames()).toEqual(["King T'Challa"])
    expect(state().pendingTriggerPrompt?.triggers[0].event).toBe('any-player-draws')

    state().acceptPendingTriggers()
    state().resolveStack(state().stack.at(-1)!.id)
    expect(handCount(1)).toBe(3)
    expect(state().pendingTriggerPrompt).toBeNull()
  })

  it("King T'Challa fires on an opponent's second draw too, and the draw is its controller's", () => {
    withTChalla()

    state().drawCard(0)
    expect(state().pendingTriggerPrompt).toBeNull()
    state().drawCard(0)
    expect(promptedNames()).toEqual(["King T'Challa"])

    state().acceptPendingTriggers()
    state().resolveStack(state().stack.at(-1)!.id)
    expect(handCount(1)).toBe(1)
    expect(handCount(0)).toBe(2)
  })

  it("Lotho fires on its controller's own second spell and on an opponent's, never on a first", () => {
    withScenarioStarted()
    withBattlefieldCards(1, [card({ id: 'lotho', name: 'Lotho, Corrupt Shirriff', cardType: 'creature', ...detectCardMetadata(LOTHO) })])
    withHandCards(1, [card({ id: 'own1', name: 'Brainstorm', cardType: 'instant' }), card({ id: 'own2', name: 'Ponder', cardType: 'sorcery' })])
    withHandCards(2, [card({ id: 'opp1', name: 'Opt', cardType: 'instant' }), card({ id: 'opp2', name: 'Consider', cardType: 'instant' })])

    state().castToStack(1, 'own1', 'hand', 'cast')
    expect(state().pendingTriggerPrompt).toBeNull()
    state().castToStack(1, 'own2', 'hand', 'cast')
    expect(promptedNames()).toEqual(['Lotho, Corrupt Shirriff'])
    state().dismissPendingTriggers()

    state().castToStack(2, 'opp1', 'hand', 'cast')
    expect(state().pendingTriggerPrompt).toBeNull()
    state().castToStack(2, 'opp2', 'hand', 'cast')
    expect(promptedNames()).toEqual(['Lotho, Corrupt Shirriff'])
  })

  it('the noncreature qualifier holds for any-player-casts: Ruric Thar ignores creature spells, its controller\'s included', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [card({ id: 'ruric', name: 'Ruric Thar, the Unbowed', cardType: 'creature', ...detectCardMetadata(RURIC_THAR) })])
    withHandCards(1, [card({ id: 'bear', name: 'Grizzly Bears', cardType: 'creature' }), card({ id: 'bolt', name: 'Lightning Bolt', cardType: 'instant' })])

    state().castToStack(1, 'bear', 'hand', 'cast')
    expect(state().pendingTriggerPrompt).toBeNull()
    state().castToStack(1, 'bolt', 'hand', 'cast')
    expect(promptedNames()).toEqual(['Ruric Thar, the Unbowed'])
  })
})

describe('undoLastAction restores turnCounters', () => {
  it('reverts counters incremented by a cast', () => {
    withScenarioStarted()
    withHandCards(0, [card({ id: 'spell1', name: 'Lightning Bolt', cardType: 'instant' })])
    const countersBefore = useBuilderStore.getState().turnCounters

    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')
    expect(useBuilderStore.getState().turnCounters).not.toEqual(countersBefore)

    useBuilderStore.getState().undoLastAction()
    expect(useBuilderStore.getState().turnCounters).toEqual(countersBefore)
  })
})

describe('ordinal gate uses the counter matching the event kind', () => {
  it('gates a draw-based spellNumber tag against cardsDrawnThisTurn, not spellsCastThisTurn', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [card({ id: 'watcher', name: 'Second Card Watcher', cardType: 'enchantment', triggerTag: { event: 'opponent-draws', spellNumber: 2 } })])
    withHandCards(0, [
      card({ id: 'spell1', name: 'Bolt1', cardType: 'instant' }),
      card({ id: 'spell2', name: 'Bolt2', cardType: 'instant' }),
    ])
    const players = useBuilderStore.getState().players!
    const updated = [...players] as typeof players
    updated[0] = { ...updated[0], zones: { ...updated[0].zones, library: { cards: [card({ id: 'lib1', name: 'Island', cardType: 'land' }), card({ id: 'lib2', name: 'Forest', cardType: 'land' })], revealed: false, cardCount: 2 } } }
    useBuilderStore.setState({ players: updated })

    // spellsCastThisTurn[0] reaches 2 first — if the ordinal gate incorrectly
    // read the spell counter, this would wrongly match already.
    useBuilderStore.getState().castToStack(0, 'spell1', 'hand', 'cast')
    useBuilderStore.getState().castToStack(0, 'spell2', 'hand', 'cast')
    expect(useBuilderStore.getState().turnCounters.spellsCastThisTurn[0]).toBe(2)

    useBuilderStore.getState().drawCard(0)
    expect(useBuilderStore.getState().pendingTriggerPrompt).toBeNull()

    useBuilderStore.getState().drawCard(0)
    expect(useBuilderStore.getState().pendingTriggerPrompt?.triggers).toHaveLength(1)
  })
})

describe('ETB, creature-dies, and your-upkeep firing on existing actions', () => {
  it('moveCard into the battlefield fires permanent-etb-yours, including a card triggering off its own entry', () => {
    withScenarioStarted()
    withHandCards(0, [card({ id: 'mulldrifter', name: 'Mulldrifter', cardType: 'creature', triggerTag: { event: 'permanent-etb-yours' } })])

    useBuilderStore.getState().moveCard(0, 'mulldrifter', 'hand', 'battlefield')

    const prompt = useBuilderStore.getState().pendingTriggerPrompt
    expect(prompt?.triggers).toHaveLength(1)
    expect(prompt?.triggers[0].sourceCard.name).toBe('Mulldrifter')
  })

  it('moveCard from battlefield to graveyard fires creature-dies only for creatures', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [card({ id: 'artist', name: 'Blood Artist', cardType: 'creature', triggerTag: { event: 'creature-dies' } })])
    withBattlefieldCards(0, [card({ id: 'bear', name: 'Bear', cardType: 'creature' })])

    useBuilderStore.getState().moveCard(0, 'bear', 'battlefield', 'graveyard')

    expect(useBuilderStore.getState().pendingTriggerPrompt?.triggers).toHaveLength(1)
  })

  it('moveCard from battlefield to graveyard does not fire creature-dies for a noncreature permanent', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [card({ id: 'artist', name: 'Blood Artist', cardType: 'creature', triggerTag: { event: 'creature-dies' } })])
    withBattlefieldCards(0, [card({ id: 'rock', name: 'Signet', cardType: 'artifact' })])

    useBuilderStore.getState().moveCard(0, 'rock', 'battlefield', 'graveyard')

    expect(useBuilderStore.getState().pendingTriggerPrompt).toBeNull()
  })

  it('resolveStack firing a creature onto the battlefield also fires permanent-etb-yours', () => {
    withScenarioStarted()
    withHandCards(0, [card({ id: 'mulldrifter', name: 'Mulldrifter', cardType: 'creature', triggerTag: { event: 'permanent-etb-yours' } })])
    useBuilderStore.getState().castToStack(0, 'mulldrifter', 'hand', 'cast')
    const stackItem = useBuilderStore.getState().stack[0]
    useBuilderStore.setState({ pendingTriggerPrompt: null })

    useBuilderStore.getState().resolveStack(stackItem.id)

    expect(useBuilderStore.getState().pendingTriggerPrompt?.triggers).toHaveLength(1)
  })

  it('passTurn fires your-upkeep for the new active player', () => {
    withScenarioStarted()
    const players = useBuilderStore.getState().players!
    const updated = [...players] as typeof players
    updated[1] = { ...updated[1], zones: { ...updated[1].zones, battlefield: { cards: [card({ id: 'arena', name: 'Phyrexian Arena', cardType: 'enchantment', triggerTag: { event: 'your-upkeep' } })], revealed: true } } }
    useBuilderStore.setState({ players: updated })

    useBuilderStore.getState().passTurn()

    const prompt = useBuilderStore.getState().pendingTriggerPrompt
    expect(prompt?.triggers).toHaveLength(1)
    expect(prompt?.triggers[0].sourceCard.name).toBe('Phyrexian Arena')
  })
})

describe('trigger effects on resolution', () => {
  // Verbatim Scryfall oracle text, fetched live.
  const RHYSTIC_STUDY = 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.'
  const CONSECRATED_SPHINX = 'Flying\nWhenever an opponent draws a card, you may draw two cards.'
  const SMOTHERING_TITHE = `Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")`
  const FAERIE_MASTERMIND = 'Flash\nFlying\nWhenever an opponent draws their second card each turn, you draw a card.\n{3}{U}: Each player draws a card.'
  const BLOOD_ARTIST = 'Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life.'
  const ALHAMMARRETS_ARCHIVE = 'If you would gain life, you gain twice that much life instead.\nIf you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.'
  const NOTION_THIEF = 'Flash\nIf an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card.'
  const ANOINTED_PROCESSION = 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.'
  const MONDRAK = 'If one or more tokens would be created under your control, twice that many of those tokens are created instead.\n{1}{W/P}{W/P}, Sacrifice two other artifacts and/or creatures: Put an indestructible counter on Mondrak. ({W/P} can be paid with either {W} or 2 life.)'
  const OPPOSITION_AGENT = "Flash\nYou control your opponents while they're searching their libraries.\nWhile an opponent is searching their library, they exile each card they find. You may play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast them."

  const fromText = (id: string, name: string, cardType: Card['cardType'], text: string) =>
    card({ id, name, cardType, ...detectCardMetadata(text) })
  const state = () => useBuilderStore.getState()
  const handCount = (playerIndex: number) => {
    const hand = state().players![playerIndex].zones.hand
    return hand.cardCount ?? hand.cards.length
  }
  const topOfStack = () => state().stack.at(-1)!
  const resolveTop = () => state().resolveStack(topOfStack().id)
  const battlefield = (playerIndex: number) => state().players![playerIndex].zones.battlefield.cards

  // Player 0 casts a spell; Rhystic Study is on player 2's battlefield.
  function castIntoRhysticStudy(extraBattlefield: Partial<Record<0 | 1 | 2 | 3, Card[]>> = {}) {
    withScenarioStarted()
    withBattlefieldCards(2, [fromText('rhystic', 'Rhystic Study', 'enchantment', RHYSTIC_STUDY), ...(extraBattlefield[2] ?? [])])
    for (const index of [0, 1, 3] as const) {
      if (extraBattlefield[index]) withBattlefieldCards(index, extraBattlefield[index]!)
    }
    withHandCards(0, [card({ id: 'bolt', name: 'Lightning Bolt', cardType: 'instant' })])
    state().castToStack(0, 'bolt', 'hand', 'cast')
    state().acceptPendingTriggers()
    expect(topOfStack().sourceCardName).toBe('Rhystic Study')
  }

  describe('draw', () => {
    it("draws for the trigger's controller, not the player whose spell triggered it", () => {
      castIntoRhysticStudy()
      const before = [0, 1, 2, 3].map(handCount)

      resolveTop()

      expect(handCount(2)).toBe(before[2] + 1)
      expect(handCount(0)).toBe(before[0])
      expect(handCount(1)).toBe(before[1])
      expect(handCount(3)).toBe(before[3])
      expect(state().stack.map(s => s.sourceCardName)).toEqual(['Lightning Bolt'])
      expect(state().logLines.at(-1)).toBe('Opponent 2 draws a card.')
    })

    it('draws the parsed count — Consecrated Sphinx draws two, through drawCard so the draw counter moves too', () => {
      withScenarioStarted()
      withBattlefieldCards(1, [fromText('sphinx', 'Consecrated Sphinx', 'creature', CONSECRATED_SPHINX)])
      state().drawCard(0)
      state().acceptPendingTriggers()

      resolveTop()

      expect(handCount(1)).toBe(2)
      expect(state().turnCounters.cardsDrawnThisTurn[1]).toBe(2)
    })

    it("the effect's own draws fire other triggers as usual (Rhystic Study's draw offers the caster's Smothering Tithe)", () => {
      castIntoRhysticStudy({ 0: [fromText('tithe', 'Smothering Tithe', 'enchantment', SMOTHERING_TITHE)] })

      resolveTop()

      expect(state().pendingTriggerPrompt?.triggers.map(t => t.sourceCard.name)).toEqual(['Smothering Tithe'])
    })

    it('one undo takes back the whole resolution, not just its last draw', () => {
      withScenarioStarted()
      withBattlefieldCards(1, [fromText('sphinx', 'Consecrated Sphinx', 'creature', CONSECRATED_SPHINX)])
      state().drawCard(0)
      state().acceptPendingTriggers()
      const stackBefore = state().stack

      resolveTop()
      expect(handCount(1)).toBe(2)

      state().undoLastAction()
      expect(handCount(1)).toBe(0)
      expect(state().stack).toEqual(stackBefore)
    })
  })

  describe('createToken', () => {
    it('creates the named token for the controller, stacking onto it on later resolutions', () => {
      withScenarioStarted()
      withBattlefieldCards(1, [fromText('tithe', 'Smothering Tithe', 'enchantment', SMOTHERING_TITHE)])

      state().drawCard(0)
      state().acceptPendingTriggers()
      resolveTop()
      const treasure = battlefield(1).find(c => c.name === 'Treasure')
      expect(treasure).toMatchObject({ isToken: true, cardType: 'artifact', stackCount: 1 })
      expect(battlefield(0).some(c => c.name === 'Treasure')).toBe(false)

      state().drawCard(0)
      state().acceptPendingTriggers()
      resolveTop()
      expect(battlefield(1).filter(c => c.name === 'Treasure')).toHaveLength(1)
      expect(battlefield(1).find(c => c.name === 'Treasure')?.stackCount).toBe(2)
    })

    it("borrows the art of a same-named token already on any battlefield", () => {
      withScenarioStarted()
      withBattlefieldCards(3, [card({ id: 'existing', name: 'Treasure', cardType: 'artifact', isToken: true, imageUrl: 'https://cards.scryfall.io/normal/front/treasure.jpg' })])
      withBattlefieldCards(1, [fromText('tithe', 'Smothering Tithe', 'enchantment', SMOTHERING_TITHE)])

      state().drawCard(0)
      state().acceptPendingTriggers()
      resolveTop()

      expect(battlefield(1).find(c => c.name === 'Treasure')?.imageUrl).toBe('https://cards.scryfall.io/normal/front/treasure.jpg')
    })

    describe('Scryfall art when there is nothing to borrow', () => {
      const TREASURE_ART = 'https://cards.scryfall.io/normal/back/2/1/21f5880d-6272-4ba8-bdf8-f9a7e54a3336.jpg'
      const scryfallTreasure: Card = { id: 'sf-treasure', name: 'Treasure', cardType: 'artifact', imageUrl: TREASURE_ART, isToken: true }
      const settle = () => new Promise(resolve => setTimeout(resolve, 0))
      function deferredLookup() {
        let resolve!: (card: Card | undefined) => void
        mockFetchTokenCard.mockReturnValue(new Promise(r => { resolve = r }))
        return (card: Card | undefined) => resolve(card)
      }
      function resolveTitheTrigger() {
        state().drawCard(0)
        state().acceptPendingTriggers()
        resolveTop()
      }
      beforeEach(() => {
        withScenarioStarted()
        withBattlefieldCards(1, [fromText('tithe', 'Smothering Tithe', 'enchantment', SMOTHERING_TITHE)])
      })

      it('with no Treasure on any battlefield, the token appears at once as a tile and gets real art when the lookup returns', async () => {
        const finishLookup = deferredLookup()

        resolveTitheTrigger()
        expect(mockFetchTokenCard).toHaveBeenCalledWith('Treasure')
        expect(battlefield(1).find(c => c.name === 'Treasure')?.imageUrl).toBeUndefined()

        finishLookup(scryfallTreasure)
        await settle()
        expect(battlefield(1).find(c => c.name === 'Treasure')).toMatchObject({ imageUrl: TREASURE_ART, cardType: 'artifact', isToken: true })
      })

      it('a same-named token on a battlefield is borrowed without asking Scryfall', () => {
        withBattlefieldCards(3, [card({ id: 'existing', name: 'Treasure', cardType: 'artifact', isToken: true, imageUrl: TREASURE_ART })])
        resolveTitheTrigger()
        expect(mockFetchTokenCard).not.toHaveBeenCalled()
      })

      it('a failed or empty lookup leaves the labelled tile', async () => {
        mockFetchTokenCard.mockRejectedValueOnce(new Error('offline'))
        resolveTitheTrigger()
        await settle()
        expect(battlefield(1).find(c => c.name === 'Treasure')?.imageUrl).toBeUndefined()

        mockFetchTokenCard.mockResolvedValueOnce(undefined)
        resolveTitheTrigger()
        await settle()
        expect(battlefield(1).find(c => c.name === 'Treasure')).toMatchObject({ stackCount: 2 })
        expect(battlefield(1).find(c => c.name === 'Treasure')?.imageUrl).toBeUndefined()
      })

      it('a lookup that returns some other token is ignored', async () => {
        mockFetchTokenCard.mockResolvedValue({ ...scryfallTreasure, name: 'Dinosaur // Treasure' })
        resolveTitheTrigger()
        await settle()
        expect(battlefield(1).find(c => c.name === 'Treasure')?.imageUrl).toBeUndefined()
      })

      it('filling in art is not an undo step, and reaches undo snapshots and saved steps taken before it returned', async () => {
        const finishLookup = deferredLookup()
        resolveTitheTrigger()
        state().saveStep('Tithe resolved')
        state().drawCard(2)

        finishLookup(scryfallTreasure)
        await settle()
        expect(state().steps[0].boardState.players[1].zones.battlefield.cards.find(c => c.name === 'Treasure')?.imageUrl).toBe(TREASURE_ART)

        // Undoes Opponent 2's draw, not the art fill; the restored board has the art.
        state().undoLastAction()
        expect(handCount(2)).toBe(0)
        expect(battlefield(1).find(c => c.name === 'Treasure')?.imageUrl).toBe(TREASURE_ART)
      })
    })
  })

  describe('effects fire only when the trigger resolves', () => {
    it('countering the trigger draws nothing', () => {
      castIntoRhysticStudy()
      const before = handCount(2)
      state().removeFromStack(topOfStack().id)
      expect(handCount(2)).toBe(before)
    })

    it('exiling the trigger draws nothing', () => {
      castIntoRhysticStudy()
      const before = handCount(2)
      state().exileFromStack(topOfStack().id)
      expect(handCount(2)).toBe(before)
    })

    it('dismissing the prompt puts nothing on the stack and draws nothing', () => {
      withScenarioStarted()
      withBattlefieldCards(2, [fromText('rhystic', 'Rhystic Study', 'enchantment', RHYSTIC_STUDY)])
      withHandCards(0, [card({ id: 'bolt', name: 'Lightning Bolt', cardType: 'instant' })])
      state().castToStack(0, 'bolt', 'hand', 'cast')
      state().dismissPendingTriggers()
      resolveTop()
      expect(handCount(2)).toBe(0)
    })

    it("an activated ability of a card with a draw-trigger effect does not carry out that effect (Faerie Mastermind's {3}{U})", () => {
      withScenarioStarted()
      withBattlefieldCards(1, [fromText('mastermind', 'Faerie Mastermind', 'creature', FAERIE_MASTERMIND)])
      state().castToStack(1, 'mastermind', 'battlefield', 'activated')
      resolveTop()
      expect(handCount(1)).toBe(0)
    })

    it('resolving during setup carries out nothing', () => {
      withBattlefieldCards(2, [fromText('rhystic', 'Rhystic Study', 'enchantment', RHYSTIC_STUDY)])
      state().castToStack(2, 'rhystic', 'battlefield', 'triggered')
      resolveTop()
      expect(handCount(2)).toBe(0)
    })
  })

  it('a trigger with no parseable effect resolves as a silent no-op', () => {
    withScenarioStarted()
    withBattlefieldCards(1, [fromText('artist', 'Blood Artist', 'creature', BLOOD_ARTIST)])
    expect(battlefield(1)[0].triggerTag).toEqual({ event: 'creature-dies' })
    state().castToStack(1, 'artist', 'battlefield', 'triggered')
    const playersBefore = state().players

    resolveTop()

    expect(state().players).toEqual(playersBefore)
    expect(state().stack).toHaveLength(0)
    expect(state().pendingTriggerPrompt).toBeNull()
    expect(state().librarySearch).toBeNull()
    expect(state().logLines.at(-1)).toBe("Blood Artist's ability resolves.")
  })

  describe('library search opens the library view for the searcher', () => {
    it('a resolving tutor requests the library view for its controller', () => {
      withScenarioStarted()
      withHandCards(3, [card({ id: 'tutor', name: 'Demonic Tutor', cardType: 'sorcery', searchesLibrary: true })])
      state().castToStack(3, 'tutor', 'hand', 'cast')
      expect(state().librarySearch).toBeNull()

      resolveTop()
      expect(state().librarySearch).toMatchObject({ playerIndex: 3, alerts: [] })
    })

    it('a resolving fetch land activation requests it too, and each search gets a new request id', () => {
      withScenarioStarted()
      withBattlefieldCards(1, [
        card({ id: 'tarn', name: 'Scalding Tarn', cardType: 'land', searchesLibrary: true }),
        card({ id: 'delta', name: 'Polluted Delta', cardType: 'land', searchesLibrary: true }),
      ])
      state().castToStack(1, 'tarn', 'battlefield', 'activated')
      resolveTop()
      const first = state().librarySearch
      expect(first?.playerIndex).toBe(1)

      state().castToStack(1, 'delta', 'battlefield', 'activated')
      resolveTop()
      expect(state().librarySearch?.playerIndex).toBe(1)
      expect(state().librarySearch?.requestId).not.toBe(first?.requestId)
    })

    it('a countered tutor does not open it', () => {
      withScenarioStarted()
      withHandCards(0, [card({ id: 'tutor', name: 'Demonic Tutor', cardType: 'sorcery', searchesLibrary: true })])
      state().castToStack(0, 'tutor', 'hand', 'cast')
      state().removeFromStack(topOfStack().id)
      expect(state().librarySearch).toBeNull()
    })

    it('a trigger that both draws and searches does both', () => {
      withScenarioStarted()
      withBattlefieldCards(0, [card({
        id: 'both', name: 'Draw And Search', cardType: 'creature', searchesLibrary: true,
        triggerTag: { event: 'permanent-etb-yours', effect: { kind: 'draw', count: 1 } },
      })])
      state().castToStack(0, 'both', 'battlefield', 'triggered')
      resolveTop()
      expect(handCount(0)).toBe(1)
      expect(state().librarySearch?.playerIndex).toBe(0)
    })

    it('closeLibrarySearch clears the request', () => {
      withScenarioStarted()
      withHandCards(0, [card({ id: 'tutor', name: 'Demonic Tutor', cardType: 'sorcery', searchesLibrary: true })])
      state().castToStack(0, 'tutor', 'hand', 'cast')
      resolveTop()
      state().closeLibrarySearch()
      expect(state().librarySearch).toBeNull()
    })
  })

  describe('alerts for replacement effects (behavior unchanged)', () => {
    it("Alhammarret's Archive under the drawer's control: alert names it, and the trigger still draws exactly the printed 1", () => {
      castIntoRhysticStudy({ 2: [fromText('archive', "Alhammarret's Archive", 'artifact', ALHAMMARRETS_ARCHIVE)] })

      const alerts = resolutionAlerts(state().players!, topOfStack())
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toMatch(/^Alhammarret's Archive \(Opponent 2\) changes draws/)

      const before = handCount(2)
      resolveTop()
      expect(handCount(2)).toBe(before + 1)
    })

    it("Alhammarret's Archive under someone else's control does not alert (it only changes its controller's draws)", () => {
      castIntoRhysticStudy({ 0: [fromText('archive', "Alhammarret's Archive", 'artifact', ALHAMMARRETS_ARCHIVE)] })
      expect(resolutionAlerts(state().players!, topOfStack())).toEqual([])
    })

    it("Notion Thief under an opponent of the drawer alerts (it changes opponents' draws)", () => {
      castIntoRhysticStudy({ 1: [fromText('thief', 'Notion Thief', 'creature', NOTION_THIEF)] })
      expect(resolutionAlerts(state().players!, topOfStack())).toEqual([
        'Notion Thief (Opponent 1) changes draws — this draws 1 as printed; adjust by hand.',
      ])
    })

    it.each([
      ['Anointed Procession', 'enchantment', ANOINTED_PROCESSION],
      ['Mondrak, Glory Dominus', 'creature', MONDRAK],
    ] as const)('%s alerts on a token effect for its controller, and the token count is unchanged', (name, cardType, text) => {
      withScenarioStarted()
      withBattlefieldCards(1, [fromText('tithe', 'Smothering Tithe', 'enchantment', SMOTHERING_TITHE), fromText('doubler', name, cardType, text)])
      state().drawCard(0)
      state().acceptPendingTriggers()

      expect(resolutionAlerts(state().players!, topOfStack())).toEqual([
        `${name} (Opponent 1) changes token creation — this creates 1 Treasure as printed; adjust by hand.`,
      ])

      resolveTop()
      expect(battlefield(1).find(c => c.name === 'Treasure')?.stackCount).toBe(1)
    })

    it('a token doubler does not alert on a draw effect, nor a draw replacement on a token effect', () => {
      castIntoRhysticStudy({ 2: [fromText('procession', 'Anointed Procession', 'enchantment', ANOINTED_PROCESSION)] })
      expect(resolutionAlerts(state().players!, topOfStack())).toEqual([])
    })
  })

  describe('alerts for Opposition Agent (behavior unchanged)', () => {
    it("an opponent's Opposition Agent alerts on a resolving search, the alert reaches the library view, and the view still opens for the searcher", () => {
      withScenarioStarted()
      withBattlefieldCards(1, [fromText('agent', 'Opposition Agent', 'creature', OPPOSITION_AGENT)])
      withHandCards(0, [card({ id: 'tutor', name: 'Demonic Tutor', cardType: 'sorcery', searchesLibrary: true })])
      state().castToStack(0, 'tutor', 'hand', 'cast')

      const alerts = resolutionAlerts(state().players!, topOfStack())
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toMatch(/^Opposition Agent \(Opponent 1\): Opponent 1 controls Player during this search, seeing their library and hand\./)
      expect(alerts[0]).toMatch(/Player gets nothing/)

      resolveTop()
      expect(state().librarySearch).toMatchObject({ playerIndex: 0, alerts })
      expect(state().players![0].zones.hand.cards).toHaveLength(0)
    })

    it("the searcher's own Opposition Agent does not alert", () => {
      withScenarioStarted()
      withBattlefieldCards(0, [fromText('agent', 'Opposition Agent', 'creature', OPPOSITION_AGENT)])
      withHandCards(0, [card({ id: 'tutor', name: 'Demonic Tutor', cardType: 'sorcery', searchesLibrary: true })])
      state().castToStack(0, 'tutor', 'hand', 'cast')
      expect(resolutionAlerts(state().players!, topOfStack())).toEqual([])
    })

    it('Opposition Agent does not alert on items that do not search', () => {
      castIntoRhysticStudy({ 1: [fromText('agent', 'Opposition Agent', 'creature', OPPOSITION_AGENT)] })
      expect(resolutionAlerts(state().players!, topOfStack())).toEqual([])
    })
  })
})

describe('turn bookkeeping: doesNotUntap, drawForTurn, pass turn at upkeep, cleanup discards, land drops', () => {
  // Verbatim Scryfall oracle text.
  const ORCISH_BOWMASTERS = 'Flash\nWhen this creature enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, this creature deals 1 damage to any target. Then amass Orcs 1.'
  const SMOTHERING_TITHE = `Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token. (It's an artifact with "{T}, Sacrifice this token: Add one mana of any color.")`
  const FAERIE_MASTERMIND = 'Flash\nFlying\nWhenever an opponent draws their second card each turn, you draw a card.\n{3}{U}: Each player draws a card.'

  const state = () => useBuilderStore.getState()
  const battlefield = (playerIndex: number) => state().players![playerIndex].zones.battlefield.cards
  const handCount = (playerIndex: number) => state().players![playerIndex].zones.hand.cardCount ?? 0
  const promptedNames = () => state().pendingTriggerPrompt?.triggers.map(t => t.sourceCard.name)
  const lands = () => state().turnCounters.landDropsThisTurn

  describe('doesNotUntap', () => {
    const pinned = () => card({ id: 'pinned', name: 'Grim Monolith', cardType: 'artifact', tapped: true, doesNotUntap: true })
    const ordinary = () => card({ id: 'ordinary', name: 'Sol Ring', cardType: 'artifact', tapped: true })

    it('Untap All leaves a doesNotUntap card tapped and untaps the rest, silently', () => {
      withScenarioStarted()
      withBattlefieldCards(0, [pinned(), ordinary()])
      const logBefore = state().logLines

      state().untapAll(0)

      expect(battlefield(0).find(c => c.id === 'pinned')).toMatchObject({ tapped: true, doesNotUntap: true })
      expect(battlefield(0).find(c => c.id === 'ordinary')?.tapped).toBe(false)
      expect(state().logLines).toEqual(logBefore)
    })

    it("passTurn's untap step leaves the new active player's doesNotUntap card tapped, with no log line about it", () => {
      withScenarioStarted()
      withBattlefieldCards(1, [pinned(), ordinary()])

      state().passTurn()

      expect(state().currentTurnPlayerIndex).toBe(1)
      expect(battlefield(1).find(c => c.id === 'pinned')).toMatchObject({ tapped: true, doesNotUntap: true })
      expect(battlefield(1).find(c => c.id === 'ordinary')?.tapped).toBe(false)
      expect(state().logLines.some(line => line.includes('Grim Monolith'))).toBe(false)
    })
  })

  describe('drawForTurn', () => {
    function withBowmastersAndTithe() {
      withScenarioStarted()
      withBattlefieldCards(1, [
        card({ id: 'bowmasters', name: 'Orcish Bowmasters', cardType: 'creature', ...detectCardMetadata(ORCISH_BOWMASTERS) }),
        card({ id: 'tithe', name: 'Smothering Tithe', cardType: 'enchantment', ...detectCardMetadata(SMOTHERING_TITHE) }),
      ])
      withLibrary(0, 5)
    }

    it('moves the top card to hand and counts the draw exactly like drawCard, and says it is the draw for the turn', () => {
      withBowmastersAndTithe()
      const topCard = state().players![0].zones.library.cards.at(-1)!

      state().drawForTurn(0)

      expect(state().players![0].zones.hand.cards.map(c => c.id)).toEqual([topCard.id])
      expect(state().players![0].zones.library.cardCount).toBe(4)
      expect(state().turnCounters.cardsDrawnThisTurn[0]).toBe(1)
      expect(state().logLines.at(-1)).toBe('Player draws for the turn.')
    })

    it('does not trigger Orcish Bowmasters, while ordinary draw triggers (Smothering Tithe) still fire', () => {
      withBowmastersAndTithe()

      state().drawForTurn(0)

      expect(promptedNames()).toEqual(['Smothering Tithe'])
    })

    it('an ordinary draw still triggers Bowmasters — an upkeep draw before the draw step, and a draw after it', () => {
      withBowmastersAndTithe()

      state().drawCard(0)
      expect(promptedNames()).toEqual(['Orcish Bowmasters', 'Smothering Tithe'])
      state().dismissPendingTriggers()

      state().drawForTurn(0)
      expect(promptedNames()).toEqual(['Smothering Tithe'])
      state().dismissPendingTriggers()

      state().drawCard(0)
      expect(promptedNames()).toEqual(['Orcish Bowmasters', 'Smothering Tithe'])
    })

    it('counts toward "second card each turn" like any draw (Faerie Mastermind fires on the draw after it)', () => {
      withScenarioStarted()
      withBattlefieldCards(1, [card({ id: 'mastermind', name: 'Faerie Mastermind', cardType: 'creature', ...detectCardMetadata(FAERIE_MASTERMIND) })])
      withLibrary(0, 5)

      state().drawForTurn(0)
      expect(state().pendingTriggerPrompt).toBeNull()
      state().drawCard(0)
      expect(promptedNames()).toEqual(['Faerie Mastermind'])
    })

    it('is one undo step', () => {
      withBowmastersAndTithe()
      state().drawForTurn(0)
      state().undoLastAction()
      expect(handCount(0)).toBe(0)
      expect(state().turnCounters.cardsDrawnThisTurn[0]).toBe(0)
    })
  })

  describe('passTurn stops at upkeep', () => {
    it('advances, untaps, resets counters, and offers upkeep triggers, but draws nothing for the new active player', () => {
      withScenarioStarted()
      withLibrary(1, 5)
      withBattlefieldCards(1, [card({ id: 'arena', name: 'Phyrexian Arena', cardType: 'enchantment', triggerTag: { event: 'your-upkeep' } })])

      state().passTurn()

      expect(state().currentTurnPlayerIndex).toBe(1)
      expect(handCount(1)).toBe(0)
      expect(state().players![1].zones.library.cardCount).toBe(5)
      expect(state().turnCounters.cardsDrawnThisTurn).toEqual([0, 0, 0, 0])
      expect(promptedNames()).toEqual(['Phyrexian Arena'])
      expect(state().logLines.some(line => line.includes('draws'))).toBe(false)
    })
  })

  // The discard modal's two buttons: "Discard and pass turn" discards then
  // calls passTurn; "Discard only" discards and leaves the turn where it is.
  // Pass Turn opens the modal only while discardsToHandSize is above zero.
  describe('cleanup discards', () => {
    function withNineCardHand() {
      withScenarioStarted()
      withHandCards(0, Array.from({ length: 9 }, (_, i) => card({ id: `h${i}`, name: `Card ${i}`, cardType: 'instant' })))
    }
    const discardsNeeded = () => discardsToHandSize(state().players![0], state().handSizes[0])

    it('Discard and pass turn: discarding down then passing ends the turn with no discard warning', () => {
      withNineCardHand()
      expect(discardsNeeded()).toBe(2)

      state().moveCard(0, 'h0', 'hand', 'graveyard')
      state().moveCard(0, 'h1', 'hand', 'graveyard')
      expect(discardsNeeded()).toBe(0)
      state().passTurn()

      expect(state().currentTurnPlayerIndex).toBe(1)
      expect(state().players![0].zones.graveyard.cards.map(c => c.id)).toEqual(['h0', 'h1'])
      expect(state().logLines.some(line => line.includes('must discard'))).toBe(false)
    })

    it('Discard only: the turn stays put so a discard trigger can go on the stack and resolve, and the next Pass Turn just passes', () => {
      withNineCardHand()
      withBattlefieldCards(0, [card({ id: 'waste-not', name: 'Waste Not', cardType: 'enchantment' })])

      state().moveCard(0, 'h0', 'hand', 'graveyard')
      state().moveCard(0, 'h1', 'hand', 'graveyard')
      expect(state().currentTurnPlayerIndex).toBe(0)

      state().castToStack(0, 'waste-not', 'battlefield', 'triggered')
      state().resolveStack(state().stack.at(-1)!.id)
      expect(state().stack).toEqual([])
      expect(state().currentTurnPlayerIndex).toBe(0)

      expect(discardsNeeded()).toBe(0)
      state().passTurn()
      expect(state().currentTurnPlayerIndex).toBe(1)
      expect(state().logLines.some(line => line.includes('must discard'))).toBe(false)
    })

    it('Skip cleanup still passes over hand size and notes the required discard', () => {
      withNineCardHand()
      state().passTurn()
      expect(state().currentTurnPlayerIndex).toBe(1)
      expect(state().logLines).toContain('Player must discard down to 7 cards.')
    })
  })

  describe('land drops', () => {
    const forest = (id = 'forest') => card({ id, name: 'Forest', cardType: 'land' })

    it('counts a land moving from hand to the battlefield, for that player only', () => {
      withScenarioStarted()
      withHandCards(2, [forest(), card({ id: 'bear', name: 'Grizzly Bears', cardType: 'creature' })])

      state().moveCard(2, 'forest', 'hand', 'battlefield')
      state().moveCard(2, 'bear', 'hand', 'battlefield')

      expect(lands()).toEqual([0, 0, 1, 0])
    })

    it('counts every way a land arrives, with no limit: from the graveyard, from the library, added directly, resolved from the stack, en masse', () => {
      withScenarioStarted()
      const players = state().players!
      const updated = [...players] as typeof players
      updated[0] = {
        ...players[0],
        zones: {
          ...players[0].zones,
          graveyard: { cards: [forest('gy-forest')], revealed: true, cardCount: 1 },
          library: { cards: [forest('lib-forest')], revealed: false, cardCount: 1 },
          exile: { cards: [forest('ex-1'), forest('ex-2'), card({ id: 'ex-spell', name: 'Brainstorm', cardType: 'instant' })], revealed: true, cardCount: 3 },
          hand: { cards: [forest('hand-forest')], revealed: false, cardCount: 1 },
        },
      }
      useBuilderStore.setState({ players: updated })

      state().moveCard(0, 'gy-forest', 'graveyard', 'battlefield')
      state().moveCard(0, 'lib-forest', 'library', 'battlefield')
      state().addCard(0, 'battlefield', forest('added'))
      state().castToStack(0, 'hand-forest', 'hand', 'cast')
      state().resolveStack(state().stack.at(-1)!.id)
      state().moveAllCards(0, 'exile', 'battlefield')

      expect(lands()[0]).toBe(6)
    })

    it('does not count before the scenario starts (setup is board construction)', () => {
      withHandCards(0, [forest()])
      state().moveCard(0, 'forest', 'hand', 'battlefield')
      expect(lands()).toEqual([0, 0, 0, 0])
    })

    it('is author-editable, clamped at zero, resets on passTurn, and undoes with the move', () => {
      withScenarioStarted()
      withHandCards(0, [forest()])

      state().moveCard(0, 'forest', 'hand', 'battlefield')
      expect(lands()[0]).toBe(1)
      state().undoLastAction()
      expect(lands()[0]).toBe(0)

      state().setLandDropsThisTurn(1, 3)
      expect(lands()).toEqual([0, 3, 0, 0])
      state().setLandDropsThisTurn(1, -2)
      expect(lands()[1]).toBe(0)

      state().setLandDropsThisTurn(0, 2)
      state().passTurn()
      expect(lands()).toEqual([0, 0, 0, 0])
    })

    it('a scenario saved before land drops existed loads with them at zero', () => {
      const { players, steps } = state()
      state().loadScenario({
        title: 'Old save', description: '', difficulty: 'beginner',
        data: {
          steps, decklists: [[], [], [], []], firstPlayerIndex: 0, currentTurnPlayerIndex: 0, turnNumber: 1, handSizes: [7, 7, 7, 7],
          workingState: {
            players: players!, stack: [], logLines: [], lastSavedLogIndex: 0, setupComplete: [true, true, true, true], scenarioStarted: true,
            turnCounters: { spellsCastThisTurn: [1, 0, 0, 0], totalSpellsCastThisTurn: 1, cardsDrawnThisTurn: [0, 0, 0, 0] } as unknown as TurnCounters,
          },
        },
      })
      expect(state().turnCounters.landDropsThisTurn).toEqual([0, 0, 0, 0])
      expect(state().turnCounters.spellsCastThisTurn).toEqual([1, 0, 0, 0])
    })
  })
})
