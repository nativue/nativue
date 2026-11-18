// FlatList's windowing math: where each row starts, and which rows a scroll position shows.

/** Where each row starts, plus where the last one ends: `heights.length + 1` offsets. */
export function rowOffsets(heights: number[]): number[] {
  const offsets = [0]
  for (const height of heights) offsets.push(offsets[offsets.length - 1] + height)

  return offsets
}

/** The row at `position`, clamped to the rows there are: a bounce past either end stays on them. */
export function rowAt(offsets: number[], position: number): number {
  let low = 0
  let high = offsets.length - 2

  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (offsets[middle] <= position) low = middle
    else high = middle - 1
  }

  return Math.max(low, 0)
}
