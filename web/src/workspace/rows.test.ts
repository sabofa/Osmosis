import { describe, it, expect } from 'vitest'
import { addableCourses, courseRowModels } from './rows'
import type { ChildRow, CourseRow, NodeKind, NodeSummary } from './wsApi'

function node(id: string, kind: NodeKind = 'course'): NodeSummary {
  return { id, kind, title: id, kind_tag: null, type: null, class: null, placement_count: 1, has_children: false, trashed_at: null }
}
const child = (n: NodeSummary, name = n.id): ChildRow => ({ placement_id: `${n.id}@track`, name, node: n })
const track = { id: 't1', title: 'quant' }

describe('courseRowModels: a course placed directly in the track can be removed from it', () => {
  const amc = node('amc')
  const calc = node('calc')
  const courses: CourseRow[] = [
    { node: amc, path: ['AMC prep'] },
    { node: calc, path: ['Year 1', 'Calc'] },
  ]
  const children = [child(amc, 'AMC prep'), child(node('Year 1', 'folder'), 'Year 1')]

  it('takes the placement and the container from the track children for a direct course', () => {
    const [row] = courseRowModels(courses, children, track)
    expect(row.placementId).toBe('amc@track')
    expect(row.container).toEqual({ id: 't1', title: 'quant' })
    expect(row.name).toBe('AMC prep')
    expect(row.label).toBe('AMC prep')
  })
  it('leaves a course reached through a folder without a placement here, shown by its path', () => {
    const [, row] = courseRowModels(courses, children, track)
    expect(row.placementId).toBeNull()
    expect(row.container).toBeNull()
    expect(row.label).toBe('Year 1 / Calc')
    expect(row.name).toBe('Calc')
  })
  it('does not invent a placement for a direct course the children read did not list', () => {
    const [row] = courseRowModels(courses, [], track)
    expect(row.placementId).toBeNull()
    expect(row.container).toBeNull()
  })
})

describe('addableCourses: the live courses not already in the reach of the track', () => {
  const [a, b, c] = [node('a'), node('b'), node('c')]
  it('drops the ones the track already reaches, by any route', () => {
    const reach: CourseRow[] = [{ node: a, path: ['a'] }, { node: c, path: ['f', 'c'] }]
    expect(addableCourses([a, b, c], reach).map((n) => n.id)).toEqual(['b'])
  })
  it('offers everything when the track has no courses, and nothing that is not a course', () => {
    expect(addableCourses([a, b], []).map((n) => n.id)).toEqual(['a', 'b'])
    expect(addableCourses([node('f', 'folder')], [])).toEqual([])
  })
})
