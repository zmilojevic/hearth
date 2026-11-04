import { UserRound } from 'lucide-react'
import { useStore } from '../store'
import { isPhone } from '../util'
import { accountDetail, accountLabel } from '../accounts'
import Dropdown from './Dropdown'

const ADD = '__add'

/** Top-bar chip (desktop, only with two or more Claude accounts): shows the active account and switches it. */
export default function AccountSwitcher() {
  const accounts = useStore((s) => s.accounts)
  if (isPhone || accounts.accounts.length < 2) return null
  const active = accounts.accounts.find((a) => a.id === accounts.active) ?? accounts.accounts[0]
  const options = [
    ...accounts.accounts.map((a) => ({ value: a.id, label: accountLabel(a), description: accountDetail(a) || undefined })),
    { value: ADD, label: 'Add account…' },
  ]
  return (
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
  )
}
