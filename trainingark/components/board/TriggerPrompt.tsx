'use client'

import { useBuilderStore } from '@/store/builderStore'
import { EVENT_TYPE_LABELS } from '@/lib/triggerDetection'
import styles from './TriggerPrompt.module.css'

export function TriggerPrompt() {
  const { pendingTriggerPrompt, triggerStackOrder, acceptPendingTriggers, dismissPendingTriggers } = useBuilderStore()

  if (!pendingTriggerPrompt) return null

  const { triggers } = pendingTriggerPrompt
  // Ask for an ordering preference only the first time two or more triggers
  // match the same event in a scenario — acceptPendingTriggers remembers the
  // choice for the rest of the session, so this only appears once.
  const needsOrderChoice = triggers.length > 1 && triggerStackOrder === null

  return (
    <div className={styles.panel}>
      <div className={styles.label}>Trigger{triggers.length > 1 ? 's' : ''} detected</div>
      <div className={styles.list}>
        {triggers.map(trigger => (
          <div key={trigger.sourceCard.id} className={styles.row}>
            <span className={styles.event}>{EVENT_TYPE_LABELS[trigger.event]}</span>
            <span className={styles.source}>{trigger.sourceCard.name} ({trigger.controller})</span>
          </div>
        ))}
      </div>
      {needsOrderChoice ? (
        <div className={styles.actions}>
          <button className={styles.acceptBtn} onClick={() => acceptPendingTriggers('first-listed-first')}>
            Resolve first-listed first
          </button>
          <button className={styles.acceptBtn} onClick={() => acceptPendingTriggers('last-listed-first')}>
            Resolve last-listed first
          </button>
          <button className={styles.dismissBtn} onClick={() => dismissPendingTriggers()}>
            Dismiss
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button className={styles.acceptBtn} onClick={() => acceptPendingTriggers()}>Accept</button>
          <button className={styles.dismissBtn} onClick={() => dismissPendingTriggers()}>Dismiss</button>
        </div>
      )}
    </div>
  )
}
