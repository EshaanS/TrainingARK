'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useBuilderStore } from '@/store/builderStore'
import { TarkLogo } from '@/components/shell/TarkLogo'
import { useAuth } from '@/lib/useAuth'
import {
  builderDraftStorageKey,
  isMeaningfulBuilderDraft,
  parseBuilderDraft,
  pendingDraftExitRequest,
  serializeBuilderDraft,
} from '@/lib/builderDraft'
import styles from './BuilderHeader.module.css'

const DIFFICULTY_LABELS = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
} as const

// Quiet period after the last change before an autosave fires.
const AUTOSAVE_DELAY_MS = 3000
// How long "Saved" stays on screen before the indicator goes quiet.
const SAVED_INDICATOR_MS = 2000

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface ScenarioListItem {
  id: string
  title: string
  description: string
  difficulty: string
  updatedAt: string
  visibility: ScenarioVisibility
}

type ScenarioVisibility = 'DRAFT' | 'UNLISTED' | 'PUBLIC'

function removeLocalRecoveryDraft(userId: string) {
  try {
    localStorage.removeItem(builderDraftStorageKey(userId))
  } catch (err) {
    console.error('Could not clear local draft recovery copy:', err)
  }
}

export function BuilderHeader({ initialScenarioId }: { initialScenarioId?: string } = {}) {
  const {
    scenarioTitle, setScenarioTitle,
    scenarioDescription, setScenarioDescription,
    difficulty, setDifficulty,
    players, steps, decklists,
    firstPlayerIndex, currentTurnPlayerIndex, turnNumber, handSizes,
    loadScenario, resetScenario,
    stack, logLines, lastSavedLogIndex, setupComplete, scenarioStarted, turnCounters,
  } = useBuilderStore()

  const router = useRouter()
  const { user } = useAuth()

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [savedScenarioId, setSavedScenarioId] = useState<string | null>(null)
  const [scenarioAuthorId, setScenarioAuthorId] = useState<string | null>(null)
  const [visibility, setVisibility] = useState<ScenarioVisibility>('DRAFT')
  const [savingVisibility, setSavingVisibility] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showLoad, setShowLoad] = useState(false)
  const [scenarioList, setScenarioList] = useState<ScenarioListItem[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [loadingScenario, setLoadingScenario] = useState(false)

  // One save-state for both the manual button and autosave, so the header
  // never shows two competing save indicators.
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  // Refs, not state: the debounced timer must always see current values.
  const scenarioIdRef = useRef<string | null>(null)
  const savingRef = useRef(false)
  const rerunRef = useRef(false)
  const mountedRef = useRef(false)
  const skipNextAutosaveRef = useRef(false)
  const lastSavedBodyRef = useRef<string | null>(null)
  const latestBodyRef = useRef('')
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recoveryCheckedRef = useRef(false)

  function commitTitle() {
    if (titleInput.trim()) setScenarioTitle(titleInput.trim())
    setEditingTitle(false)
  }

  // Commanders found wherever they currently sit, via the isCommander flag —
  // not just the command zone, so cast/moved commanders still count.
  const commanders = players
    ? players.flatMap(p =>
        Object.values(p.zones).flatMap(z => z.cards)
          .filter(c => c.isCommander)
          .map(c => c.name)
      ).filter(Boolean)
    : []

  const canPreview = !!savedScenarioId && steps.length > 0
  const canSave = isMeaningfulBuilderDraft({
    title: scenarioTitle,
    description: scenarioDescription,
    setupComplete,
    stepCount: steps.length,
    scenarioStarted,
  })
  const isOwner = !!savedScenarioId && !!user && scenarioAuthorId === user.id

  function buildPayload() {
    return {
      title: scenarioTitle,
      description: scenarioDescription,
      difficulty,
      commanders,
      data: {
        steps,
        decklists,
        firstPlayerIndex,
        currentTurnPlayerIndex,
        turnNumber,
        handSizes,
        commanders,
        workingState: {
          players,
          stack,
          logLines,
          lastSavedLogIndex,
          setupComplete,
          scenarioStarted,
          turnCounters,
        },
      },
    }
  }

  const currentBody = JSON.stringify(buildPayload())

  function flashSaved() {
    setSaveState('saved')
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSaveState('idle'), SAVED_INDICATOR_MS)
  }

  async function performSave({ silent }: { silent: boolean }) {
    // The builder is behind a server-side login gate, so a missing session
    // here is a genuine error rather than something to skip quietly.
    if (!user) {
      setSaveState('error')
      setSaveError('Not signed in — sign in again to save.')
      return
    }

    const body = JSON.stringify(buildPayload())
    latestBodyRef.current = body

    // Autosave skips no-op writes (e.g. right after a manual save).
    if (silent && body === lastSavedBodyRef.current) return

    if (savingRef.current) {
      // A save is already in flight; queue one more pass afterwards so the
      // newest state still lands and we never double-POST a new scenario.
      rerunRef.current = true
      return
    }

    savingRef.current = true
    setSaveState('saving')
    setSaveError(null)

    try {
      const id = scenarioIdRef.current
      const res = await fetch(id ? `/api/scenarios/${id}` : '/api/scenarios', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result = await res.json()

      if (result.id) {
        const isFirstSave = scenarioIdRef.current === null
        scenarioIdRef.current = result.id
        setSavedScenarioId(result.id)
        if (isFirstSave) {
          window.history.replaceState(null, '', `/builder?id=${encodeURIComponent(result.id)}`)
        }
      }
      if (result.authorId !== undefined) setScenarioAuthorId(result.authorId)
      if (result.visibility) setVisibility(result.visibility)

      lastSavedBodyRef.current = body
      removeLocalRecoveryDraft(user.id)
      flashSaved()
    } catch (err) {
      console.error('Save failed:', err)
      setSaveState('error')
      setSaveError('Save failed')
    } finally {
      savingRef.current = false
      if (rerunRef.current) {
        rerunRef.current = false
        void saveRef.current({ silent: true })
      }
    }
  }

  // Always call the latest closure from timers and the retry path.
  const saveRef = useRef(performSave)
  useEffect(() => {
    saveRef.current = performSave
  })

  // Debounced autosave starts as soon as the draft contains intentional work;
  // an untouched blank builder does not create database clutter.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false
      lastSavedBodyRef.current = currentBody
      return
    }
    if (!canSave) return

    const timer = setTimeout(() => { void saveRef.current({ silent: true }) }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [canSave, currentBody])

  // Recover work that never reached its first server save. Server-backed
  // scenarios always load by id and therefore take precedence.
  useEffect(() => {
    if (!user || initialScenarioId || recoveryCheckedRef.current) return
    recoveryCheckedRef.current = true
    const key = builderDraftStorageKey(user.id)
    let raw: string | null
    try {
      raw = localStorage.getItem(key)
    } catch (err) {
      console.error('Could not read local draft recovery copy:', err)
      return
    }
    if (!raw) return

    const recovered = parseBuilderDraft(raw, user.id)
    if (!recovered) {
      removeLocalRecoveryDraft(user.id)
      return
    }

    const payload = JSON.parse(recovered.body)
    if (window.confirm('Recover your unsaved builder draft from this browser?')) {
      loadScenario(payload)
    } else {
      removeLocalRecoveryDraft(user.id)
    }
  }, [initialScenarioId, loadScenario, user])

  // Keep a per-account recovery copy until a brand-new draft receives its
  // server id. This covers refreshes and crashes during the first debounce.
  useEffect(() => {
    latestBodyRef.current = currentBody
    if (!user || scenarioIdRef.current) return

    const key = builderDraftStorageKey(user.id)
    if (!canSave) {
      removeLocalRecoveryDraft(user.id)
      return
    }

    try {
      localStorage.setItem(key, serializeBuilderDraft(user.id, currentBody))
    } catch (err) {
      console.error('Could not store local draft recovery copy:', err)
    }
  }, [user, canSave, currentBody])

  // A final keepalive PUT closes the debounce gap for drafts that already have
  // a server id. The normal autosave remains the primary path.
  useEffect(() => {
    function flushPendingSave() {
      const request = pendingDraftExitRequest(
        scenarioIdRef.current,
        latestBodyRef.current,
        lastSavedBodyRef.current
      )
      if (!request) return
      void fetch(request.url, request.init).catch(() => undefined)
    }

    window.addEventListener('pagehide', flushPendingSave)
    return () => window.removeEventListener('pagehide', flushPendingSave)
  }, [])

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
  }, [])

  async function handleVisibilityChange(nextVisibility: ScenarioVisibility) {
    if (!savedScenarioId || savingVisibility || nextVisibility === visibility) return
    const previousVisibility = visibility
    setVisibility(nextVisibility)
    setSavingVisibility(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/scenarios/${savedScenarioId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: nextVisibility }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result = await res.json()
      setVisibility(result.visibility)
    } catch (err) {
      console.error('Visibility update failed:', err)
      setVisibility(previousVisibility)
      setSaveState('error')
      setSaveError('Visibility update failed')
    } finally {
      setSavingVisibility(false)
    }
  }

  async function handleDelete() {
    if (!savedScenarioId || deleting) return
    const confirmed = window.confirm(
      `Delete "${scenarioTitle}" permanently? This cannot be undone.`
    )
    if (!confirmed) return

    setDeleting(true)
    try {
      const res = await fetch(`/api/scenarios/${savedScenarioId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      skipNextAutosaveRef.current = true
      scenarioIdRef.current = null
      lastSavedBodyRef.current = null
      if (user) removeLocalRecoveryDraft(user.id)
      setSavedScenarioId(null)
      setScenarioAuthorId(null)
      setVisibility('DRAFT')
      setSaveState('idle')
      setSaveError(null)
      resetScenario()
      router.replace('/builder')
      router.refresh()
    } catch (err) {
      console.error('Delete failed:', err)
      setSaveState('error')
      setSaveError('Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  function handlePreview() {
    if (!canPreview || !savedScenarioId) return
    window.open(`/scenario/${savedScenarioId}`, '_blank')
  }

  async function openLoadModal() {
    setShowLoad(true)
    setLoadingList(true)
    try {
      // `mine=1` returns creator-only content, including drafts and unlisted
      // scenarios that discovery deliberately excludes.
      const res = await fetch('/api/scenarios?mine=1')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const list = await res.json()
      setScenarioList(list)
    } catch (err) {
      console.error('Failed to load scenario list:', err)
      setScenarioList([])
    } finally {
      setLoadingList(false)
    }
  }

  async function handleLoadScenario(id: string) {
    if (loadingScenario || savingRef.current) return
    setLoadingScenario(true)
    try {
      const res = await fetch(`/api/scenarios/${id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const scenario = await res.json()

      // Loading rewrites most of the store; don't let that churn trigger an
      // immediate autosave of what we just read back.
      skipNextAutosaveRef.current = true
      loadScenario({
        title: scenario.title,
        description: scenario.description,
        difficulty: scenario.difficulty,
        data: scenario.data,
      })
      scenarioIdRef.current = scenario.id
      lastSavedBodyRef.current = null
      setSavedScenarioId(scenario.id)
      setScenarioAuthorId(scenario.authorId ?? null)
      setVisibility(scenario.visibility)
      setSaveState('idle')
      setSaveError(null)
      setShowLoad(false)
      window.history.replaceState(null, '', `/builder?id=${encodeURIComponent(scenario.id)}`)
    } catch (err) {
      console.error('Failed to load scenario:', err)
    } finally {
      setLoadingScenario(false)
    }
  }

  // Deep link from the dashboard: /builder?id=xxx opens pre-loaded. This reuses
  // the Load modal's own loader so there is a single load path — including its
  // autosave suppression and its scenarioIdRef assignment, which is what makes
  // the next autosave a PUT rather than a second POST.
  const autoLoadedRef = useRef(false)

  useEffect(() => {
    if (!initialScenarioId || autoLoadedRef.current) return
    autoLoadedRef.current = true
    void handleLoadScenario(initialScenarioId)
    // handleLoadScenario is a fresh closure every render; the ref guard makes
    // this strictly one-shot, so re-running on that identity would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScenarioId])

  return (
    <div className={styles.header}>
      <div className={styles.left}>
        <Link href="/" className={styles.homeLink} title="Back to home" aria-label="Back to TrainingARK home">
          <TarkLogo size="small" />
        </Link>
        {editingTitle ? (
          <input
            className={styles.titleInput}
            value={titleInput}
            onChange={e => setTitleInput(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => {
              if (e.key === 'Enter') commitTitle()
              if (e.key === 'Escape') setEditingTitle(false)
            }}
            autoFocus
          />
        ) : (
          <span
            className={styles.title}
            onClick={() => { setTitleInput(scenarioTitle); setEditingTitle(true) }}
            title="Click to edit title"
          >
            {scenarioTitle}
          </span>
        )}
        <span className={`${styles.difficultyBadge} ${styles[`badge_${difficulty}`]}`}>
          {DIFFICULTY_LABELS[difficulty]}
        </span>
        {savedScenarioId && (
          <select
            className={`${styles.publishBtn} ${visibility === 'PUBLIC' ? styles.publishBtnLive : ''}`}
            value={visibility}
            onChange={e => { void handleVisibilityChange(e.target.value as ScenarioVisibility) }}
            disabled={savingVisibility}
            title="Drafts are private, unlisted scenarios work by link, and public scenarios appear in discovery"
          >
            <option value="DRAFT">Draft</option>
            <option value="UNLISTED">Unlisted</option>
            <option value="PUBLIC">Public</option>
          </select>
        )}
      </div>

      <div className={styles.right}>
        {saveState === 'saving' && <span className={styles.saveStatusPending}>Saving...</span>}
        {saveState === 'saved' && <span className={styles.saveStatusOk}>Saved</span>}
        {saveState === 'error' && (
          <span className={styles.saveStatusError}>{saveError ?? 'Save failed'}</span>
        )}
        <button className={styles.detailsBtn} onClick={openLoadModal}>
          Load
        </button>
        <button
          className={styles.detailsBtn}
          onClick={handlePreview}
          disabled={!canPreview}
          title={!savedScenarioId
            ? 'Save the scenario first'
            : steps.length === 0
              ? 'Save at least one step first'
              : 'Play this scenario as a player (opens in a new tab)'}
        >
          Preview
        </button>
        <button
          className={styles.saveScenarioBtn}
          onClick={() => { void performSave({ silent: false }) }}
          disabled={saveState === 'saving' || !canSave}
          title={!canSave
            ? 'Add a title, description, player setup, or scenario step first'
            : 'Save scenario to database'}
        >
          {savedScenarioId ? 'Update scenario' : 'Save scenario'}
        </button>
        {isOwner && (
          <button
            className={styles.deleteBtn}
            onClick={handleDelete}
            disabled={deleting}
            title="Delete this scenario permanently"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        )}
        <button className={styles.detailsBtn} onClick={() => setShowDetails(true)}>
          Details
        </button>
      </div>

      {showDetails && createPortal(
        <div className={styles.detailsBackdrop} onClick={() => setShowDetails(false)}>
          <div className={styles.detailsModal} onClick={e => e.stopPropagation()}>
            <div className={styles.detailsHeader}>
              <span className={styles.detailsTitle}>Scenario details</span>
              <button className={styles.detailsClose} onClick={() => setShowDetails(false)}>×</button>
            </div>

            <label className={styles.fieldLabel}>Title</label>
            <input
              className={styles.fieldInput}
              value={scenarioTitle}
              onChange={e => setScenarioTitle(e.target.value)}
            />

            <label className={styles.fieldLabel}>Description</label>
            <textarea
              className={styles.fieldTextarea}
              placeholder="What does this scenario teach? What situation is the player dropped into?"
              value={scenarioDescription}
              onChange={e => setScenarioDescription(e.target.value)}
              rows={4}
            />

            <label className={styles.fieldLabel}>Difficulty</label>
            <select
              className={styles.fieldSelect}
              value={difficulty}
              onChange={e => setDifficulty(e.target.value as 'beginner' | 'intermediate' | 'advanced')}
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>

            <label className={styles.fieldLabel}>Featured commanders</label>
            {commanders.length === 0 ? (
              <p className={styles.commandersEmpty}>Set up players to populate commanders.</p>
            ) : (
              <div className={styles.commandersList}>
                {commanders.map((name, i) => (
                  <span key={i} className={styles.commanderChip}>{name}</span>
                ))}
              </div>
            )}

            <button className={styles.doneBtn} onClick={() => setShowDetails(false)}>
              Done
            </button>
          </div>
        </div>,
        document.body
      )}

      {showLoad && createPortal(
        <div className={styles.detailsBackdrop} onClick={() => setShowLoad(false)}>
          <div className={styles.detailsModal} onClick={e => e.stopPropagation()}>
            <div className={styles.detailsHeader}>
              <span className={styles.detailsTitle}>Load scenario</span>
              <button className={styles.detailsClose} onClick={() => setShowLoad(false)}>×</button>
            </div>

            <p className={styles.loadWarning}>
              Loading replaces the current builder. Autosave protects your work; wait for Saving to finish first.
            </p>

            {loadingList ? (
              <p className={styles.commandersEmpty}>Loading...</p>
            ) : scenarioList.length === 0 ? (
              <p className={styles.commandersEmpty}>No saved scenarios.</p>
            ) : (
              <div className={styles.loadList}>
                {scenarioList.map(s => (
                  <button
                    key={s.id}
                    className={styles.loadRow}
                    onClick={() => handleLoadScenario(s.id)}
                    disabled={loadingScenario || saveState === 'saving'}
                  >
                    <span className={styles.loadRowTitle}>{s.title}</span>
                    <span className={styles.loadRowMeta}>
                      {s.visibility === 'PUBLIC' ? 'Public' : s.visibility === 'UNLISTED' ? 'Unlisted' : 'Draft'} · {s.difficulty} · {new Date(s.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
