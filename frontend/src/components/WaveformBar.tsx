import { useEffect, useRef } from 'react'

export interface WaveformBarProps {
  amplitudes: Uint8Array
  active: boolean
}

export function WaveformBar({ amplitudes, active }: WaveformBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvas
    ctx.clearRect(0, 0, width, height)

    // Read color from CSS custom properties — no hardcoded hex in component.
    const styles = getComputedStyle(document.documentElement)
    const activeColor = styles.getPropertyValue('--color-neon-cyan').trim() || 'cyan'
    const inactiveColor = styles.getPropertyValue('--color-text-muted').trim() || 'gray'

    ctx.fillStyle = active ? activeColor : inactiveColor

    const barCount = amplitudes.length
    const barWidth = width / barCount
    const midY = height / 2

    for (let i = 0; i < barCount; i++) {
      // Time-domain data: 128 = silence, 0–255 range → normalise to −1..+1
      const normalised = ((amplitudes[i] ?? 128) - 128) / 128
      const barHeight = Math.max(2, Math.abs(normalised) * height)
      ctx.fillRect(i * barWidth, midY - barHeight / 2, Math.max(1, barWidth - 1), barHeight)
    }
  }, [amplitudes, active])

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={48}
      className="w-full rounded"
      aria-hidden="true"
    />
  )
}
