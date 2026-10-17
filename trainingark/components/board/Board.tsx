'use client'

import { useBuilderStore, resolutionAlerts } from '@/store/builderStore'
import type { Player, StackItem } from '@/types/board'
import { PlayerZone } from './PlayerZone'
import { TriggerPrompt } from './TriggerPrompt'
import styles from './Board.module.css'

interface BoardProps {
  revealAll?: boolean
  // viewMode + snapshot: read-only rendering of a saved step for the scenario
  // viewer. The snapshot fully replaces store data so nothing leaks between
  // the builder session and the viewer.
  viewMode?: boolean
  snapshot?: {
    players: [Player, Player, Player, Player]
    stack: StackItem[]
  }
}

export function Board({ revealAll, viewMode, snapshot }: BoardProps) {
  const { players, stack: storeStack, resolveStack, removeFromStack, exileFromStack, setStormCopyCount } = useBuilderStore()

  const stack = viewMode && snapshot ? snapshot.stack : storeStack

  return (
    <div className={styles.wrapper}>
      <div className={styles.grid}>
        <PlayerZone playerIndex={2} position="top-left" revealAll={viewMode ? undefined : revealAll} viewMode={viewMode} playerOverride={snapshot?.players[2]} />
        <PlayerZone playerIndex={3} position="top-right" revealAll={viewMode ? undefined : revealAll} viewMode={viewMode} playerOverride={snapshot?.players[3]} />
        <PlayerZone playerIndex={1} position="bottom-left" revealAll={viewMode ? undefined : revealAll} viewMode={viewMode} playerOverride={snapshot?.players[1]} />
        <PlayerZone playerIndex={0} position="bottom-right" revealAll={viewMode ? undefined : revealAll} viewMode={viewMode} playerOverride={snapshot?.players[0]} />

        {stack.length > 0 && (
          <div className={styles.stackZone}>
            <div className={styles.stackLabel}>Stack ({stack.length})</div>
            {[...stack].reverse().map((item, idx) => (
              <div key={item.id} className={styles.stackItem}>
                <span className={styles.stackType}>
                  {item.type === 'cast' ? '✦' : item.type === 'triggered' ? '⟳' : '⚡'}
                </span>
                <span className={styles.stackName}>{item.sourceCardName}</span>
                <span className={styles.stackController}>{item.controller}</span>
                {!viewMode && item.stormCopyCount !== undefined && (
                  <div className={styles.stormStepper}>
                    <button
                      className={styles.stormStepperBtn}
                      onClick={() => setStormCopyCount(item.id, item.stormCopyCount! - 1)}
                      title="Decrease locked copy count"
                    >
                      −
                    </button>
                    <span className={styles.stormCount}>×{item.stormCopyCount}</span>
                    <button
                      className={styles.stormStepperBtn}
                      onClick={() => setStormCopyCount(item.id, item.stormCopyCount! + 1)}
                      title="Increase locked copy count"
                    >
                      +
                    </button>
                  </div>
                )}
                {!viewMode && idx === 0 && (
                  <div className={styles.stackActions}>
                    <button onClick={() => resolveStack(item.id)} title="Resolve">✓</button>
                    <button onClick={() => removeFromStack(item.id)} title="Counter">✕</button>
                    {item.type === 'cast' && (
                      <button onClick={() => exileFromStack(item.id)} title="Exile">⊗</button>
                    )}
                  </div>
                )}
                {/* Authoring-only: board permanents that make the parsed
                    effect inaccurate. Resolving still does exactly what was
                    parsed; the note tells the author what to fix by hand. */}
                {!viewMode && players && resolutionAlerts(players, item).map(alert => (
                  <div key={alert} className={styles.stackAlert}>⚠ {alert}</div>
                ))}
              </div>
            ))}
          </div>
        )}

        {!viewMode && <TriggerPrompt />}
      </div>
    </div>
  )
}