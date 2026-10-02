// A minimal fake DOM for constructing SpaceRenderer in node: just the element
// members the overlay, the label pool and the input layer use. A test helper.

// A plain string-keyed store (element.style.color = '...' still reads and
// writes as a normal property) with setProperty/removeProperty/
// getPropertyValue added as non-enumerable methods, so overlay.ts's real
// CSSStyleDeclaration calls (custom properties: --space-surface and the
// like) work here too, without changing how every existing test reads a
// style property. FakeStyle's own type is an intersection, not one
// interface trying to declare both the string index signature and these
// three methods: TypeScript refuses that combination outright (a method's
// function type is never assignable to a plain `string` index type,
// TS2411) even though the two are perfectly fine held apart and merged —
// which is exactly this object's real runtime shape.
export type FakeStyle = Record<string, string> & {
  getPropertyValue(prop: string): string
  setProperty(prop: string, value: string): void
  removeProperty(prop: string): void
}

function fakeStyle(): FakeStyle {
  const style: Record<string, string> = {}
  Object.defineProperties(style, {
    setProperty: { value: (prop: string, value: string) => { style[prop] = value }, enumerable: false },
    removeProperty: { value: (prop: string) => { delete style[prop] }, enumerable: false },
    getPropertyValue: { value: (prop: string) => style[prop] ?? '', enumerable: false },
  })
  return style as FakeStyle
}

export class FakeElement {
  readonly tagName: string
  readonly style: FakeStyle = fakeStyle()
  readonly dataset: Record<string, string> = {}
  readonly children: FakeElement[] = []
  readonly ownerDocument: FakeDocument
  parentElement: FakeElement | null = null
  className = ''
  tabIndex = -1
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()
  // Real DOM semantics: reading textContent concatenates every descendant's
  // (an element with children has no "own" text of its own); assigning it
  // replaces every child with that one text run, same as the real DOM.
  private ownText = ''

  get textContent(): string {
    return this.children.length === 0 ? this.ownText : this.children.map((c) => c.textContent).join('')
  }

  set textContent(value: string) {
    this.ownText = value
    this.children.length = 0
  }

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
