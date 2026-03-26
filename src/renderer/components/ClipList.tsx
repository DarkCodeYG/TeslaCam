import React from 'react'

interface Props {
  clips: ClipGroup[]
  selectedClip: ClipGroup | null
  onSelect: (clip: ClipGroup) => void
}

export default function ClipList({ clips, selectedClip, onSelect }: Props) {
  return (
    <div style={{
      width: 220, background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)', overflowY: 'auto', flexShrink: 0,
    }}>
      <div style={{
        padding: '10px 12px', fontSize: 12, fontWeight: 700,
        color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)',
        textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        클립 목록 ({clips.length})
      </div>
      {clips.map(clip => {
        const isSelected = selectedClip?.timestamp === clip.timestamp
        const count = Object.values(clip.files).filter(Boolean).length
        return (
          <div
            key={clip.timestamp}
            onClick={() => onSelect(clip)}
            style={{
              padding: '10px 12px', cursor: 'pointer',
              background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
              borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: isSelected ? '#fff' : 'var(--text-primary)' }}>
              {clip.time}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{clip.date}</div>
            <div style={{
              fontSize: 11, marginTop: 4,
              color: count === 4 ? 'var(--success)' : 'var(--warning)',
            }}>
              {count}채널
            </div>
          </div>
        )
      })}
    </div>
  )
}
