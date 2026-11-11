import { UserRound } from 'lucide-react'
import { useStore } from '../store'
import { isPhone } from '../util'
import { accountDetail, accountLabel, usageSummary, USAGE_STALE_MS } from '../accounts'
import Dropdown from './Dropdown'

const ADD = '__add'

/** Top-bar chip (desktop, only with two or more Claude accounts): shows the active account and switches it. */
export default function AccountSwitcher() {
  const accounts = useStore((s) => s.accounts)
  const chatAccount = useStore((s) => {
    const c = s.activeChatId ? s.chats[s.activeChatId] : undefined
    return c && c.engine !== 'codex' ? c.account : undefined
  })
  const usage = useStore((s) => s.accountUsage)
  if (isPhone || accounts.accounts.length < 2) return null
  const active = accounts.accounts.find((a) => a.id === accounts.active) ?? accounts.accounts[0]
  const options = [
    ...accounts.accounts.map((a) => {
      const u = usage[a.id]
      const sum = usageSummary(u)
      const stale = !!u && Date.now() - u.fetchedAt > USAGE_STALE_MS
      const desc = [accountDetail(a), sum ? (stale ? `${sum} (old)` : sum) : ''].filter(Boolean).join(' · ')
      return { value: a.id, label: accountLabel(a), description: desc || undefined }
    }),
    { value: ADD, label: 'Add account…' },
  ]
  const chatAcc = chatAccount && chatAccount !== accounts.active ? accounts.accounts.find((a) => a.id === chatAccount) : undefined
  const chatLabel = chatAcc ? accountLabel(chatAcc) : chatAccount
  const chatDetail = chatAcc ? accountDetail(chatAcc) : ''
  return (
    <>
    <Dropdown
      className="account-dd"
      value={active.id}
      options={options}
      icon={<UserRound size={13} />}
      labelOverride={accountLabel(active)}
      title="Claude account"
      onChange={(v) => {
        if (v === ADD) void useStore.getState().addAccount()
        else void useStore.getState().setActiveAccount(v)
      }}
    />
    {chatAccount && chatAccount !== accounts.active && (
      <span
        className="account-chat"
        title={`This chat runs on ${chatLabel}${chatDetail ? ` (${chatDetail})` : ''} – it keeps the account it started with`}
      >
        <UserRound size={12} /> <span className="account-chat-label">chat: {chatLabel}</span>
      </span>
    )}
    </>
  )
}
