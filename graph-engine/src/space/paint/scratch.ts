// Typed arrays kept between frames (the Paint Lab's orbit).
//
// Re-projecting a base's strokes, and blending two bases while one is eased in, make several arrays as long as the
// strokes are many, every animation frame: a megabyte or two a frame that the garbage collector then has to take back,
// in the middle of the frames that are to be smooth. A Scratch hands the same arrays out again while the length asked
// for is the same, which is the case for as long as the base (or the pair of bases) is.

export type Column = Float32Array | Uint8Array | Uint32Array

export class Scratch {
  // How many arrays it has had to make (a test counts them: after the first frame of a base there are no more).
  allocations = 0
  private readonly arrays = new Map<string, Column>()

  // The array kept under `key`, of `length` elements of type `make`; made when there is none yet or its length differs.
  // Its contents are whatever the last frame left in it: the caller writes every element it reads back.
  array<T extends Column>(key: string, make: new (length: number) => T, length: number): T {
    const have = this.arrays.get(key)
    if (have !== undefined && have.length === length && have instanceof make) return have as T
    const made = new make(length)
    this.arrays.set(key, made)
    this.allocations++
    return made
  }
}
