// A minimal fake DOM for constructing SpaceRenderer in node: just the element
// members the overlay, the label pool and the input layer use. A test helper.

export class FakeElement {
  readonly tagName: string
  readonly style: Record<string, string> = {}
  readonly dataset: Record<string, string> = {}
  readonly children: FakeElement[] = []
  readonly ownerDocument: FakeDocument
  parentElement: FakeElement | null = null
  className = ''
  textContent = ''
  tabIndex = -1
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  constructor(tagName: string, ownerDocument: FakeDocument) {
    this.tagName = tagName.toUpperCase()
    this.ownerDocument = ownerDocument
  }

  appendChild<T extends FakeElement>(child: T): T {
    child.parentElement?.removeChild(child)
    this.children.push(child)
    child.parentElement = this
    return child
  }

  append(...nodes: FakeElement[]): void {
    for (const n of nodes) this.appendChild(n)
  }

  removeChild<T extends FakeElement>(child: T): T {
    const i = this.children.indexOf(child)
    if (i >= 0) this.children.splice(i, 1)
    child.parentElement = null
    return child
  }

  remove(): void {
    this.parentElement?.removeChild(this)
  }

  setAttribute(name: string, value: string): void {
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = value
  }

  addEventListener(type: string, fn: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(fn)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(fn)
  }

  dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ preventDefault() {}, ...event })
  }

  listenerCount(): number {
    let n = 0
    for (const set of this.listeners.values()) n += set.size
    return n
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
  }

  focus(): void {}
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  hasPointerCapture(): boolean {
    return false
  }
}

export class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this)
  }
}
