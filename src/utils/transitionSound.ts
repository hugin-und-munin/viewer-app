// Short acoustic cue played whenever a new module mounts, so the display
// draws attention to itself at the moment content actually changes.
import transitionSoundUrl from '../assets/sounds/transition.wav'

export function playTransitionSound(): void {
  const audio = new Audio(transitionSoundUrl)
  audio.play().catch(() => {})
}
