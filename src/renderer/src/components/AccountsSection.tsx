import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X } from 'lucide-react'
import { useStore } from '../store'
import { accountDetail, accountLabel } from '../accounts'
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
      {removing && <RemoveDialog account={removing} onClose={() => setRemoving(null)} />}
    </div>
  )
}
