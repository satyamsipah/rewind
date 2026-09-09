'use client'

import { KeyRound } from 'lucide-react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'

export function SignIn() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <h1 className="text-2xl font-semibold text-foreground">Rewind</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        An offline-first, event-sourced task platform with full history and time travel. Sign in to sync across devices —
        or just start working; everything is saved locally first either way.
      </p>
      <Button onClick={() => signIn('github')} className="gap-2">
        <KeyRound className="h-4 w-4" /> Sign in with GitHub
      </Button>
    </div>
  )
}
