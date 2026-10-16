'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import type { Player } from '@/types/board'
import { detectCardMetadata } from '@/lib/triggerDetection'
import styles from './CommanderSetupModal.module.css'

const BASIC_LANDS = new Set([
	'Plains', 'Island', 'Swamp', 'Mountain', 'Forest',
	'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
	'Snow-Covered Mountain', 'Snow-Covered Forest', 'Wastes',
])

interface CommanderInfo {
	name: string
	imageUrl: string
	oracleText: string
	keywords?: unknown
	partnerType: 'none' | 'partner' | 'partner-with' | 'background' | 'friends-forever' | 'choose-background'
	partnerWith?: string
}

interface CommanderSetupModalProps {
	playerIndex: number
	playerName: string
	onConfirm: (player: Partial<Player>, commanderNames: string[], decklist: string[]) => void
}

async function fetchCommanderInfo(name: string): Promise<CommanderInfo | null> {
	try {
		const res = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`)
		if (!res.ok) return null
		const data = await res.json()
		const oracle: string = data.oracle_text ?? data.card_faces?.[0]?.oracle_text ?? ''
		const imageUrl: string = data.image_uris?.normal ?? data.card_faces?.[0]?.image_uris?.normal ?? ''
		const keywords: unknown = data.keywords ?? data.card_faces?.[0]?.keywords

		let partnerType: CommanderInfo['partnerType'] = 'none'
		let partnerWith: string | undefined

		const partnerWithMatch = oracle.match(/Partner with ([^\n(]+)/)
		if (partnerWithMatch) {
			partnerType = 'partner-with'
			partnerWith = partnerWithMatch[1].trim()
		} else if (/\bFriends forever\b/i.test(oracle)) {
			partnerType = 'friends-forever'
		} else if (/\bChoose a Background\b/i.test(oracle)) {
			partnerType = 'choose-background'
		} else if (/\bBackground\b/.test(data.type_line ?? '')) {
			partnerType = 'background'
		} else if (/\bPartner\b/.test(oracle)) {
			partnerType = 'partner'
		}

		return { name, imageUrl, oracleText: oracle, keywords, partnerType, partnerWith }
	} catch {
		return null
	}
}

export function CommanderSetupModal({ playerIndex, playerName, onConfirm }: CommanderSetupModalProps) {
	const [commanderQuery, setCommanderQuery] = useState('')
	const [commanderSuggestions, setCommanderSuggestions] = useState<string[]>([])
	const [commander1, setCommander1] = useState<CommanderInfo | null>(null)
	const [commander2, setCommander2] = useState<CommanderInfo | null>(null)
	const [partner2Query, setPartner2Query] = useState('')
	const [partner2Suggestions, setPartner2Suggestions] = useState<string[]>([])
	const [activeIndex, setActiveIndex] = useState(-1)
	const [partner2ActiveIndex, setPartner2ActiveIndex] = useState(-1)
	const [decklist, setDecklist] = useState('')
	const [decklistErrors, setDecklistErrors] = useState<string[]>([])
	const [decklistWarning, setDecklistWarning] = useState('')
	const [loadingCommander, setLoadingCommander] = useState(false)
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const debounce2Ref = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Search for commanders (legendary creatures)
	useEffect(() => {
	  if (debounceRef.current) clearTimeout(debounceRef.current)
	  if (commanderQuery.length < 1) return
	  let cancelled = false
	  debounceRef.current = setTimeout(async () => {
	    try {
	      const res = await fetch(
	        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`is:commander ${commanderQuery}`)}&unique=names`
	      )
	      if (cancelled) return
	      if (!res.ok) { setCommanderSuggestions([]); return }
	      const data = await res.json()
	      if (cancelled) return
	      setCommanderSuggestions((data.data ?? []).slice(0, 8).map((c: { name: string }) => c.name))
	      setActiveIndex(-1)
	    } catch { /* ignore */ }
	  }, 200)
	  return () => {
	    cancelled = true
	    if (debounceRef.current) clearTimeout(debounceRef.current)
	  }
	}, [commanderQuery])

	// Search for second commander based on partner type
	useEffect(() => {
		if (!commander1 || commander1.partnerType === 'none' || commander1.partnerType === 'partner-with') return
		if (debounce2Ref.current) clearTimeout(debounce2Ref.current)
		if (partner2Query.length < 2) return
		let cancelled = false
		debounce2Ref.current = setTimeout(async () => {
			try {
				let query = ''
				if (commander1.partnerType === 'partner') query = `is:commander o:partner ${partner2Query}`
				if (commander1.partnerType === 'friends-forever') query = `is:commander o:"friends forever" ${partner2Query}`
				if (commander1.partnerType === 'choose-background') query = `t:background ${partner2Query}`
				const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=names`)
				if (cancelled) return
				if (!res.ok) { setPartner2Suggestions([]); return }
				const data = await res.json()
				if (cancelled) return
				setPartner2Suggestions((data.data ?? []).slice(0, 8).map((c: { name: string }) => c.name))
				setPartner2ActiveIndex(-1)
			} catch { /* ignore */ }
		}, 200)
		return () => {
			cancelled = true
			if (debounce2Ref.current) clearTimeout(debounce2Ref.current)
		}
	}, [partner2Query, commander1])

	function handleCommanderQueryChange(value: string) {
		setCommanderQuery(value)
		setActiveIndex(-1)
		if (value.length < 1) setCommanderSuggestions([])
	}

	function handlePartner2QueryChange(value: string) {
		setPartner2Query(value)
		setPartner2ActiveIndex(-1)
		if (value.length < 2) setPartner2Suggestions([])
	}

	async function selectCommander1(name: string) {
		setCommanderQuery('')
		setCommanderSuggestions([])
		setCommander2(null)
		setPartner2Query('')
		setPartner2Suggestions([])
		setPartner2ActiveIndex(-1)
		setLoadingCommander(true)
		const info = await fetchCommanderInfo(name)
		setCommander1(info)
		setLoadingCommander(false)

		// If partner-with, auto-fetch the partner
		if (info?.partnerType === 'partner-with' && info.partnerWith) {
			const partnerInfo = await fetchCommanderInfo(info.partnerWith)
			setCommander2(partnerInfo)
		}
	}

	async function selectCommander2(name: string) {
		setPartner2Query('')
		setPartner2Suggestions([])
		const info = await fetchCommanderInfo(name)
		setCommander2(info)
	}

	function validateDecklist(raw: string): { cards: string[], errors: string[], warning: string } {
		const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
		const seen = new Map<string, number>()
		const cards: string[] = []
		const errors: string[] = []

		for (const line of lines) {
			const match = line.match(/^(\d+\s+)?(.+)$/)
			if (!match) continue
			const name = match[2].trim()
			if (!name) continue
			const isBasic = BASIC_LANDS.has(name)
			if (!isBasic && seen.has(name)) {
				errors.push(`Duplicate: ${name}`)
				continue
			}
			seen.set(name, 1)
			cards.push(name)
		}

		const warning = cards.length > 0 && cards.length < 99
			? `Only ${cards.length} cards listed. Search will be limited to these cards only.`
			: ''

		return { cards, errors, warning }
	}

	function handleDecklistChange(raw: string) {
		setDecklist(raw)
		const { errors, warning } = validateDecklist(raw)
		setDecklistErrors(errors)
		setDecklistWarning(warning)
	}

	function handleConfirm() {
		if (!commander1) return
		const { cards } = validateDecklist(decklist)
		const commanderNames = [commander1.name]
		if (commander2) commanderNames.push(commander2.name)

		const commanderCards = commanderNames.map((name, i) => {
		const info = i === 0 ? commander1 : commander2
		return {
			id: `cmd-${playerIndex}-${i}`,
			name,
			cardType: 'creature' as const,
			imageUrl: info?.imageUrl ?? '',
			isCommander: true,
			...detectCardMetadata(info?.oracleText, info?.keywords),
		}
		})

		const commanderTax: number | [number, number] = commander2 ? [0, 0] : 0
		const libraryCount = 100 - commanderNames.length

		const player: Partial<Player> = {
		zones: {
		  battlefield: { cards: [], revealed: true },
		  hand: { cards: [], revealed: false, cardCount: 0 },
		  graveyard: { cards: [], revealed: true },
		  exile: { cards: [], revealed: true },
		  command: { cards: commanderCards, revealed: true },
		  library: { cards: [], revealed: false, cardCount: libraryCount },
		},
		commanderTax,
		}

		onConfirm(player, commanderNames, cards)
		}

	const showPartnerSlot = commander1 && commander1.partnerType !== 'none'
	const partnerIsAutoFilled = commander1?.partnerType === 'partner-with'
	const canConfirm = !!commander1 && !loadingCommander

	return (
		<div className={styles.overlay}>
			<div className={styles.modal}>
				<h2 className={styles.title}>Set up {playerName}</h2>

				{/* Commander 1 */}
				<div className={styles.section}>
					<label className={styles.label}>Commander</label>
					{commander1 ? (
						<div className={styles.selectedCommander}>
							{commander1.imageUrl && (
								<Image src={commander1.imageUrl} alt={commander1.name} width={80} height={112} style={{ borderRadius: 6 }} />
							)}
							<div className={styles.selectedInfo}>
								<span className={styles.selectedName}>{commander1.name}</span>
								<button className={styles.clearBtn} onClick={() => { setCommander1(null); setCommander2(null) }}>
									Change
								</button>
							</div>
						</div>
					) : (
						<div className={styles.searchWrap}>
							<input
								className={styles.input}
								placeholder="Search for a legendary creature..."
								value={commanderQuery}
								onChange={e => handleCommanderQueryChange(e.target.value)}
								onKeyDown={e => {
									if (commanderSuggestions.length === 0) return
									if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, commanderSuggestions.length - 1)) }
									if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, -1)) }
									if (e.key === 'Enter') {
										e.preventDefault()
										const name = activeIndex >= 0 ? commanderSuggestions[activeIndex] : commanderSuggestions[0]
										if (name) selectCommander1(name)
									}
								}}
								autoComplete="off"
							/>
							{commanderSuggestions.length > 0 && (
								<ul className={styles.suggestions}>
									{commanderSuggestions.map((name, i) => (
										<li
											key={name}
											className={`${styles.suggestion} ${i === activeIndex ? styles.suggestionActive : ''}`}
											onMouseEnter={() => setActiveIndex(i)}
											onClick={() => selectCommander1(name)}
										>
											{name}
										</li>
									))}
								</ul>
							)}
						</div>
					)}
				</div>

				{/* Commander 2 / Partner */}
				{showPartnerSlot && (
					<div className={styles.section}>
						<label className={styles.label}>
							{commander1.partnerType === 'choose-background' ? 'Background' : 'Partner'}
						</label>
						{commander2 ? (
							<div className={styles.selectedCommander}>
								{commander2.imageUrl && (
									<Image src={commander2.imageUrl} alt={commander2.name} width={80} height={112} style={{ borderRadius: 6 }} />
								)}
								<div className={styles.selectedInfo}>
									<span className={styles.selectedName}>{commander2.name}</span>
									{!partnerIsAutoFilled && (
										<button className={styles.clearBtn} onClick={() => setCommander2(null)}>Change</button>
									)}
								</div>
							</div>
						) : partnerIsAutoFilled ? (
							<span className={styles.hint}>Loading partner...</span>
						) : (
							<div className={styles.searchWrap}>
								<input
									className={styles.input}
									placeholder={`Search for a ${commander1.partnerType === 'choose-background' ? 'background' : 'partner'}...`}
									value={partner2Query}
									onChange={e => handlePartner2QueryChange(e.target.value)}
									onKeyDown={e => {
										if (partner2Suggestions.length === 0) return
										if (e.key === 'ArrowDown') { e.preventDefault(); setPartner2ActiveIndex(i => Math.min(i + 1, partner2Suggestions.length - 1)) }
										if (e.key === 'ArrowUp') { e.preventDefault(); setPartner2ActiveIndex(i => Math.max(i - 1, -1)) }
										if (e.key === 'Enter') {
											e.preventDefault()
											const name = partner2ActiveIndex >= 0 ? partner2Suggestions[partner2ActiveIndex] : partner2Suggestions[0]
											if (name) selectCommander2(name)
										}
									}}
									autoComplete="off"
								/>
								{partner2Suggestions.length > 0 && (
									<ul className={styles.suggestions}>
										{partner2Suggestions.map((name, i) => (
											<li
												key={name}
												className={`${styles.suggestion} ${i === partner2ActiveIndex ? styles.suggestionActive : ''}`}
												onMouseEnter={() => setPartner2ActiveIndex(i)}
												onClick={() => selectCommander2(name)}
											>
												{name}
											</li>
										))}
									</ul>
								)}
							</div>
						)}
					</div>
				)}

				{/* Decklist */}
				<div className={styles.section}>
					<label className={styles.label}>
						Decklist <span className={styles.optional}>(optional)</span>
					</label>
					<textarea
						className={styles.textarea}
						placeholder={'Paste cards one per line.\nLeave empty to search all cards freely.'}
						value={decklist}
						onChange={e => handleDecklistChange(e.target.value)}
						rows={6}
						spellCheck={false}
					/>
					{decklistErrors.slice(0, 3).map((err, i) => (
						<p key={i} className={styles.error}>{err}</p>
					))}
					{decklistErrors.length > 3 && (
						<p className={styles.error}>+{decklistErrors.length - 3} more duplicates</p>
					)}
					{decklistWarning && <p className={styles.warning}>{decklistWarning}</p>}
				</div>

				<button
					className={styles.confirmBtn}
					onClick={handleConfirm}
					disabled={!canConfirm}
				>
					Set up board
				</button>
			</div>
		</div>
	)
}
