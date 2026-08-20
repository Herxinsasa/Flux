import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ChatInput } from '../../src/renderer/src/components/chat/ChatInput'

describe('ChatInput compact command', () => {
  it('routes /compact locally instead of sending it to the provider', () => {
    const onSend = vi.fn()
    const onCompact = vi.fn()
    render(
      <ChatInput
        onSend={onSend}
        onCancel={vi.fn()}
        onCompact={onCompact}
        isRunning={false}
        mentionFiles={[]}
        slashSkills={[]}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '/compact keep decisions' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onCompact).toHaveBeenCalledWith('keep decisions')
    expect(onSend).not.toHaveBeenCalled()
  })
})
