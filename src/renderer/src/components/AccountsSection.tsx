import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X } from 'lucide-react'
import { useStore } from '../store'
import Dropdown from './Dropdown'
import { accountDetail, accountLabel, usageSummary, USAGE_STALE_MS } from '../accounts'
import type { AccountInfo } from '@shared/types'

/** Confirms removing an extra account (its login only; chats and history are shared and stay). */
function RemoveDialog({ account, onClose }: { account: AccountInfo; onClose: () => void }) {
  const remove = (): void => {
    void useStore.getState().removeAccount(account.id)
    onClose()
  }
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        else if (e.key === 'Enter') remove()
      }}
    >
      <div className="modal">
        <div className="modal-head">
          <h3>Remove account</h3>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <p className="modal-text">
          Remove {accountLabel(account)} from Hearth? This only forgets its login here; your chats and settings are shared and stay. Chats already running with it keep running.
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger" autoFocus onClick={remove}>
            Remove
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Gear-menu section "Claude accounts": switch the active account, remove extra ones, add another. */
export default function AccountsSection() {
  const accounts = useStore((s) => s.accounts)
  const switchAt = useStore((s) => s.accountSwitchAt)
  const resumeOnSwitch = useStore((s) => s.resumeOnSwitch)
  const autoSwitch = useStore((s) => s.autoSwitchAccount)
  const usage = useStore((s) => s.accountUsage)
  const [removing, setRemoving] = useState<AccountInfo | null>(null)
  return (
    <div className="accounts-section">
      <div className="accounts-title">Claude accounts</div>
      {accounts.accounts.map((a) => {
        const active = a.id === accounts.active
        const detail = accountDetail(a) || (a.label ? '' : a.email ?? '')
        return (
          <div key={a.id} className={`account-row ${active ? 'active' : ''}`} role="button" tabIndex={0} onClick={() => void useStore.getState().setActiveAccount(a.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && void useStore.getState().setActiveAccount(a.id)}>
            <span className="account-text">
              <span className="account-name">{accountLabel(a)}</span>
              {detail && <span className="muted small account-detail">{detail}</span>}
              {usageSummary(usage[a.id]) && (
                <span className="muted small account-detail" style={usage[a.id] && Date.now() - usage[a.id]!.fetchedAt > USAGE_STALE_MS ? { opacity: 0.5 } : undefined} title="Plan usage (5-hour session · weekly)">
                  {usageSummary(usage[a.id])}
                </span>
              )}
            </span>
            {active && <span className="account-active muted small">active</span>}
            {a.id !== 'default' && (
              <button
                className="icon-btn tiny account-x"
                title="Remove account"
                onClick={(e) => {
                  e.stopPropagation()
                  setRemoving(a)
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        )
      })}
      <button className="account-add" onClick={() => void useStore.getState().addAccount()}>
        <Plus size={13} /> Add account…
      </button>
      {accounts.accounts.length >= 2 && (
        <div className="account-limit-row">
          <span className="muted small">Ask to switch at</span>
          <Dropdown
            value={String(switchAt)}
            placement="up"
            options={[
              { value: '0', label: 'Off' },
              { value: '75', label: '75%' },
              { value: '85', label: '85%' },
              { value: '90', label: '90%' },
              { value: '95', label: '95%' },
              { value: '100', label: 'Limit reached' },
            ]}
            onChange={(v) => useStore.getState().setAccountSwitchAt(Number(v))}
          />
        </div>
      )}
      {accounts.accounts.length >= 2 && (
        <label className="toggle-row">
          <span className="toggle-text">
            <span>Resume interrupted work after switching</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={resumeOnSwitch}
            className={`switch ${resumeOnSwitch ? 'on' : ''}`}
            onClick={() => useStore.getState().setResumeOnSwitch(!resumeOnSwitch)}
          >
            <span className="knob" />
          </button>
        </label>
      )}
      {accounts.accounts.length >= 2 && (
        <label className="toggle-row">
          <span className="toggle-text">
            <span>Switch automatically when a limit is hit</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={autoSwitch}
            className={`switch ${autoSwitch ? 'on' : ''}`}
            onClick={() => useStore.getState().setAutoSwitchAccount(!autoSwitch)}
          >
            <span className="knob" />
          </button>
        </label>
      )}
      {removing && <RemoveDialog account={removing} onClose={() => setRemoving(null)} />}
    </div>
  )
}
