import { type SchedulerEvent, EVENT_PRIORITY } from '../types/scheduler'

export class EventQueue {
  private events: SchedulerEvent[] = []

  push(event: SchedulerEvent): void {
    const existing = this.events.findIndex((e) => this.sameSlot(e, event))
    if (existing !== -1) {
      this.events[existing] = event // update in place — latest payload wins
    } else {
      this.events.push(event)
    }
  }

  // Two events occupy the same slot if they would represent the same "pending intention".
  // IntervalDue is keyed by module — different modules get separate slots.
  // Everything else is keyed by type alone.
  private sameSlot(a: SchedulerEvent, b: SchedulerEvent): boolean {
    if (a.type !== b.type) return false
    if (a.type === 'IntervalDue' && b.type === 'IntervalDue') {
      return a.module === b.module
    }
    return true
  }

  getHighest(): SchedulerEvent | undefined {
    if (this.events.length === 0) return undefined
    let highestIndex = 0
    for (let i = 1; i < this.events.length; i++) {
      if (EVENT_PRIORITY[this.events[i].type] < EVENT_PRIORITY[this.events[highestIndex].type]) {
        highestIndex = i
      }
    }
    return this.events[highestIndex]
  }

  remove(event: SchedulerEvent): void {
    const index = this.events.indexOf(event)
    if (index !== -1) this.events.splice(index, 1)
  }

  isEmpty(): boolean {
    return this.events.length === 0
  }

  clear(): void {
    this.events = []
  }
}
