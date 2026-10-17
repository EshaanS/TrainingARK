'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { useBuilderStore, discardsToHandSize, type ScenarioStep, type DecisionChoice } from '@/store/builderStore'
import styles from './ActionLog.module.css'

type Quality = 'best' | 'ok' | 'blunder'

interface DraftChoice {
  id: string
  label: string
  quality: Quality
  explanation: string
}

export function ActionLog() {
  const {
    logLines, editLogLine, removeLogLine, undoLastAction, scenarioStarted, startScenario,
    players, firstPlayerIndex, currentTurnPlayerIndex, turnNumber, handSizes,
    turnCounters, setTotalSpellsCastThisTurn,
    setFirstPlayer, setCurrentTurnPlayer, setTurnNumber, passTurn, moveCard,
    steps, saveStep, deleteStep, lastSavedLogIndex,
  } = useBuilderStore()

  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const [showDiscardModal, setShowDiscardModal] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [stepLabel, setStepLabel] = useState('')
  const [stepsExpanded, setStepsExpanded] = useState(false)
  const [viewingStep, setViewingStep] = useState<ScenarioStep | null>(null)
  const [confirmDeleteStep, setConfirmDeleteStep] = useState(false)

  // Decision point draft state
  const [includeDecision, setIncludeDecision] = useState(false)
  const [decisionPrompt, setDecisionPrompt] = useState('')
  const [draftChoices, setDraftChoices] = useState<DraftChoice[]>([
    { id: 'c1', label: '', quality: 'best', explanation: '' },
    { id: 'c2', label: '', quality: 'blunder', explanation: '' },
  ])

  function startEdit(index: number) {
    setEditingIndex(index)
    setEditingText(logLines[index])
  }

  function commitEdit() {
    if (editingIndex !== null && editingText.trim()) {
      editLogLine(editingIndex, editingText.trim())
    }
    setEditingIndex(null)
  }

  function handlePassTurn() {
    if (!players) return
    const currentPlayer = players[currentTurnPlayerIndex]

    if (discardsToHandSize(currentPlayer, handSizes[currentTurnPlayerIndex]) > 0 && currentPlayer.zones.hand.cards.length > 0) {
      setShowDiscardModal(true)
    } else {
      passTurn()
    }
  }

  function handleDiscardCard(cardId: string) {
    if (!players) return
    moveCard(currentTurnPlayerIndex, cardId, 'hand', 'graveyard')
  }

  function handleDiscardDone() {
    setShowDiscardModal(false)
    passTurn()
  }

  // Discarding to hand size is a turn-based action; if it triggers anything,
  // the active player gets priority before the turn ends (CR 514.1, 514.3a).
  // This stays on the current turn so the author can put those triggers on
  // the stack. Pass Turn afterwards finds the hand at size and just passes.
  function handleDiscardOnly() {
    setShowDiscardModal(false)
  }

  function resetSaveModal() {
    setStepLabel('')
    setIncludeDecision(false)
    setDecisionPrompt('')
    setDraftChoices([
      { id: 'c1', label: '', quality: 'best', explanation: '' },
      { id: 'c2', label: '', quality: 'blunder', explanation: '' },
    ])
    setShowSaveModal(false)
  }

  function updateChoice(id: string, patch: Partial<DraftChoice>) {
    setDraftChoices(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  function addChoice() {
    if (draftChoices.length >= 5) return
    setDraftChoices(prev => [...prev, {
      id: `c${Date.now()}`,
      label: '',
      quality: 'ok',
      explanation: '',
    }])
  }

  function removeChoice(id: string) {
    if (draftChoices.length <= 2) return
    setDraftChoices(prev => prev.filter(c => c.id !== id))
  }

  // Validation for the decision point section
  const decisionValid = !includeDecision || (
    decisionPrompt.trim().length > 0 &&
    draftChoices.every(c => c.label.trim() && c.explanation.trim()) &&
    draftChoices.filter(c => c.quality === 'best').length === 1
  )

  const bestCount = draftChoices.filter(c => c.quality === 'best').length

  function handleSaveStep() {
    if (!decisionValid) return
    const decisionPoint = includeDecision
      ? {
          prompt: decisionPrompt.trim(),
          choices: draftChoices.map((c): DecisionChoice => ({
            id: c.id,
            label: c.label.trim(),
            quality: c.quality,
            explanation: c.explanation.trim(),
          })),
        }
      : undefined
    saveStep(stepLabel.trim(), decisionPoint)
    resetSaveModal()
  }

  function handleDeleteLastStep() {
    const last = steps[steps.length - 1]
    if (last) deleteStep(last.id)
    setConfirmDeleteStep(false)
  }

  const playerNames = players?.map(p => p.name) ?? ['Player', 'Opponent 1', 'Opponent 2', 'Opponent 3']
  const currentPlayer = players?.[currentTurnPlayerIndex]
  const discardCount = currentPlayer ? discardsToHandSize(currentPlayer, handSizes[currentTurnPlayerIndex]) : 0

  const discardModal = showDiscardModal && currentPlayer && createPortal(
    <div className={styles.discardBackdrop} onClick={e => e.stopPropagation()}>
      <div className={styles.discardModal}>
        <div className={styles.discardHeader}>
          <span className={styles.discardTitle}>
            {discardCount > 0
              ? `${currentPlayer.name} must discard ${discardCount} card${discardCount > 1 ? 's' : ''}`
              : `${currentPlayer.name} is at hand size`}
          </span>
        </div>

        <div className={styles.discardGrid}>
          {currentPlayer.zones.hand.cards.length === 0 ? (
            <p className={styles.discardEmpty}>No cards to discard.</p>
          ) : (
            currentPlayer.zones.hand.cards.map(card => (
              <div
                key={card.id}
                className={`${styles.discardCard} ${discardCount <= 0 ? styles.discardCardDone : ''}`}
                onClick={() => { if (discardCount > 0) handleDiscardCard(card.id) }}
                title={discardCount > 0 ? `Discard ${card.name}` : ''}
              >
                <Image
                  src={card.imageUrl ?? '/back_magic.png'}
                  alt={card.name}
                  width={80}
                  height={112}
                  style={{ borderRadius: 4, display: 'block' }}
                />
                <div className={styles.discardCardOverlay}>
                  <span className={styles.discardCardName}>{card.name}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className={styles.discardActions}>
          <button className={styles.discardSkipBtn} onClick={handleDiscardDone}>
            Skip cleanup
          </button>
          <button
            className={styles.discardOnlyBtn}
            onClick={handleDiscardOnly}
            disabled={discardCount > 0}
            title="Stay on this turn to put discard triggers on the stack"
          >
            Discard only
          </button>
          <button
            className={styles.discardDoneBtn}
            onClick={handleDiscardDone}
            disabled={discardCount > 0}
          >
            {discardCount > 0 ? `Discard ${discardCount} more` : 'Discard and pass turn'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )

  const stepViewModal = viewingStep && createPortal(
    <div className={styles.stepViewBackdrop} onClick={() => setViewingStep(null)}>
      <div className={styles.stepViewModal} onClick={e => e.stopPropagation()}>
        <div className={styles.stepViewHeader}>
          <span className={styles.stepViewTitle}>{viewingStep.label}</span>
          <button className={styles.stepViewClose} onClick={() => setViewingStep(null)}>×</button>
        </div>

        <div className={styles.stepViewSection}>
          <span className={styles.stepViewSectionTitle}>Log lines</span>
          {viewingStep.logLines.length === 0 ? (
            <p className={styles.stepViewEmpty}>No log lines in this step.</p>
          ) : (
            <div className={styles.stepViewLog}>
              {viewingStep.logLines.map((line, i) => (
                <span key={i} className={styles.stepViewLogLine}>{line}</span>
              ))}
            </div>
          )}
        </div>

        <div className={styles.stepViewSection}>
          <span className={styles.stepViewSectionTitle}>Board summary</span>
          <div className={styles.stepViewBoard}>
            {viewingStep.boardState.players.map((p, i) => (
              <div key={i} className={styles.stepViewPlayer}>
                <span className={styles.stepViewPlayerName}>{p.name}</span>
                <span className={styles.stepViewPlayerStats}>
                  {p.life} life · BF {p.zones.battlefield.cards.length} · Hand {p.zones.hand.cardCount ?? p.zones.hand.cards.length} · GY {p.zones.graveyard.cardCount ?? p.zones.graveyard.cards.length}
                </span>
              </div>
            ))}
            {viewingStep.boardState.stack.length > 0 && (
              <span className={styles.stepViewStack}>
                Stack: {viewingStep.boardState.stack.map(s => s.sourceCardName).join(', ')}
              </span>
            )}
          </div>
        </div>

        {viewingStep.decisionPoint && (
          <div className={styles.stepViewSection}>
            <span className={styles.stepViewSectionTitle}>Decision point</span>
            <p className={styles.stepViewPrompt}>{viewingStep.decisionPoint.prompt}</p>
            <div className={styles.stepViewChoices}>
              {viewingStep.decisionPoint.choices.map(choice => (
                <div key={choice.id} className={styles.stepViewChoice}>
                  <span className={`${styles.stepViewChoiceQuality} ${styles[`quality_${choice.quality}`]}`}>
                    {choice.quality}
                  </span>
                  <div className={styles.stepViewChoiceBody}>
                    <span className={styles.stepViewChoiceLabel}>{choice.label}</span>
                    <span className={styles.stepViewChoiceExplanation}>{choice.explanation}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Action Log</span>
        {scenarioStarted && currentPlayer ? (
          <span className={styles.turnInfo}>T{turnNumber} — {currentPlayer.name}</span>
        ) : (
          <span className={styles.hint}>Click a line to edit</span>
        )}
      </div>

      {scenarioStarted && steps.length > 0 && (
        <div className={styles.stepsStrip}>
          <button className={styles.stepsToggle} onClick={() => setStepsExpanded(x => !x)}>
            <span>Steps ({steps.length})</span>
            <span className={styles.stepsToggleArrow}>{stepsExpanded ? '▲' : '▼'}</span>
          </button>
          {stepsExpanded && (
            <div className={styles.stepsList}>
              {steps.map((step, i) => (
                <div key={step.id} className={styles.stepRow}>
                  <span className={styles.stepRowNum}>{i + 1}</span>
                  <span className={styles.stepRowLabel} onClick={() => setViewingStep(step)} title="View step">
                    {step.label}
                    {step.decisionPoint && <span className={styles.stepRowDecision}> ◆</span>}
                  </span>
                  <span className={styles.stepRowMeta}>{step.logLines.length} lines</span>
                  {i === steps.length - 1 && (
                    confirmDeleteStep ? (
                      <span className={styles.stepDeleteConfirm}>
                        <button className={styles.stepDeleteYes} onClick={handleDeleteLastStep}>Delete</button>
                        <button className={styles.stepDeleteNo} onClick={() => setConfirmDeleteStep(false)}>Keep</button>
                      </span>
                    ) : (
                      <button
                        className={styles.stepRowDelete}
                        onClick={() => setConfirmDeleteStep(true)}
                        title="Delete this step"
                      >
                        ×
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={styles.feed}>
        {!scenarioStarted ? (
          <div className={styles.notStarted}>
            <p className={styles.empty}>Set up the board state above, then configure the turn state before starting.</p>

            <div className={styles.turnSetup}>
              <label className={styles.turnLabel}>Who goes first?</label>
              <select
                className={styles.turnSelect}
                value={firstPlayerIndex}
                onChange={e => setFirstPlayer(Number(e.target.value))}
              >
                {playerNames.map((name, i) => (
                  <option key={i} value={i}>{name}</option>
                ))}
              </select>

              <label className={styles.turnLabel}>Whose turn is it?</label>
              <select
                className={styles.turnSelect}
                value={currentTurnPlayerIndex}
                onChange={e => setCurrentTurnPlayer(Number(e.target.value))}
              >
                {playerNames.map((name, i) => (
                  <option key={i} value={i}>{name}</option>
                ))}
              </select>

              <label className={styles.turnLabel}>Turn number</label>
              <input
                className={styles.turnNumberInput}
                type="number"
                min={1}
                value={turnNumber}
                onChange={e => setTurnNumber(Math.max(1, parseInt(e.target.value) || 1))}
              />

              <label className={styles.turnLabel}>Total spells cast this turn</label>
              <input
                className={styles.turnNumberInput}
                type="number"
                min={0}
                value={turnCounters.totalSpellsCastThisTurn}
                onChange={e => setTotalSpellsCastThisTurn(Math.max(0, parseInt(e.target.value) || 0))}
              />
            </div>

            <button className={styles.startBtn} onClick={startScenario}>
              Start scenario
            </button>
          </div>
        ) : (
          <>
            {logLines.length === 0 && (
              <p className={styles.empty}>Actions will appear here as you build.</p>
            )}
            {logLines.map((line, i) => (
              <div key={i} className={`${styles.lineWrapper} ${i < lastSavedLogIndex ? styles.lineSaved : ''}`}>
                {editingIndex === i ? (
                  <input
                    className={styles.lineInput}
                    value={editingText}
                    onChange={e => setEditingText(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitEdit()
                      if (e.key === 'Escape') setEditingIndex(null)
                    }}
                    autoFocus
                  />
                ) : (
                  <span className={styles.line} onClick={() => startEdit(i)}>
                    {line}
                  </span>
                )}
                <button
                  className={styles.deleteLine}
                  onClick={() => removeLogLine(i)}
                  title="Delete line"
                >
                  ×
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {scenarioStarted && (
        <div className={styles.actions}>
          <button className={styles.undoBtn} onClick={undoLastAction} title="Undo last action">
            Undo
          </button>
          <button className={styles.passTurnBtn} onClick={handlePassTurn} title="Pass turn">
            Pass turn
          </button>
          <button
            className={styles.saveBtn}
            disabled={logLines.length === lastSavedLogIndex}
            onClick={() => setShowSaveModal(true)}
            title="Save current board state and log as a step"
          >
            Save step{steps.length > 0 ? ` (${steps.length})` : ''}
          </button>
        </div>
      )}

      {discardModal}
      {stepViewModal}

      {showSaveModal && createPortal(
        <div className={styles.saveModalBackdrop}>
          <div className={`${styles.saveModal} ${includeDecision ? styles.saveModalWide : ''}`}>
            <span className={styles.saveModalTitle}>Save step {steps.length + 1}</span>
            <input
              className={styles.saveModalInput}
              placeholder={`Step ${steps.length + 1} label (optional)`}
              value={stepLabel}
              onChange={e => setStepLabel(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !includeDecision) handleSaveStep()
                if (e.key === 'Escape') resetSaveModal()
              }}
              autoFocus
            />

            <label className={styles.decisionToggle}>
              <input
                type="checkbox"
                checked={includeDecision}
                onChange={e => setIncludeDecision(e.target.checked)}
              />
              <span>Add decision point to this step</span>
            </label>

            {includeDecision && (
              <div className={styles.decisionForm}>
                <label className={styles.turnLabel}>Prompt</label>
                <textarea
                  className={styles.decisionPromptInput}
                  placeholder="What should the player do here? e.g. 'Opponent 2 casts Thassa's Oracle with Consultation on the stack. What do you do?'"
                  value={decisionPrompt}
                  onChange={e => setDecisionPrompt(e.target.value)}
                  rows={2}
                />

                <div className={styles.decisionChoicesHeader}>
                  <label className={styles.turnLabel}>Choices ({draftChoices.length}/5)</label>
                  {bestCount !== 1 && (
                    <span className={styles.decisionWarning}>Exactly one choice must be rated best</span>
                  )}
                </div>

                {draftChoices.map((choice, i) => (
                  <div key={choice.id} className={styles.choiceRow}>
                    <div className={styles.choiceRowTop}>
                      <input
                        className={styles.choiceLabelInput}
                        placeholder={`Choice ${i + 1}`}
                        value={choice.label}
                        onChange={e => updateChoice(choice.id, { label: e.target.value })}
                      />
                      <select
                        className={styles.choiceQualitySelect}
                        value={choice.quality}
                        onChange={e => updateChoice(choice.id, { quality: e.target.value as Quality })}
                      >
                        <option value="best">Best</option>
                        <option value="ok">OK</option>
                        <option value="blunder">Blunder</option>
                      </select>
                      {draftChoices.length > 2 && (
                        <button
                          className={styles.choiceRemoveBtn}
                          onClick={() => removeChoice(choice.id)}
                          title="Remove choice"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <textarea
                      className={styles.choiceExplanationInput}
                      placeholder="Explanation shown after the player answers"
                      value={choice.explanation}
                      onChange={e => updateChoice(choice.id, { explanation: e.target.value })}
                      rows={2}
                    />
                  </div>
                ))}

                {draftChoices.length < 5 && (
                  <button className={styles.addChoiceBtn} onClick={addChoice}>
                    + Add choice
                  </button>
                )}
              </div>
            )}

            <div className={styles.saveModalActions}>
              <button className={styles.saveModalCancel} onClick={resetSaveModal}>Cancel</button>
              <button
                className={styles.saveModalConfirm}
                onClick={handleSaveStep}
                disabled={!decisionValid}
              >
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}