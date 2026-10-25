import { describe, it, expect } from 'vitest'

import { mount } from '@vue/test-utils'
import ProjectTile from '../components/projectTile.vue'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'

const tasks: Task[] = [
  { ...createEmptyTask(), id: 't1', name: 'Write report', completed: true },
  { ...createEmptyTask(), id: 't2', name: 'Review slides', dueDate: '2026-11-02' },
  { ...createEmptyTask(), id: 't3', name: 'Not in this project' },
]
const project: Project = {
  ...createEmptyProject(),
  id: 'p1',
  name: 'Thesis',
  taskIds: ['t1', 't2'],
  links: [{ label: 'GitHub repo', url: 'https://example.com/repo' }],
}

const mountTile = () => mount(ProjectTile, { props: { project, tasks } })

describe('ProjectTile', () => {
  it('starts collapsed, showing the summary but not the preview', () => {
    const wrapper = mountTile()
    expect(wrapper.text()).toContain('Thesis')
    expect(wrapper.text()).toContain('1 of 2 tasks completed')
    expect(wrapper.find('.preview').exists()).toBe(false)
    expect(wrapper.find('.tile-toggle').attributes('aria-expanded')).toBe('false')
  })

  it("expands to preview the project's tasks and links when the tile is clicked", async () => {
    const wrapper = mountTile()
    await wrapper.find('article').trigger('click')

    const preview = wrapper.find('.preview')
    expect(preview.text()).toContain('Write report')
    expect(preview.text()).toContain('Review slides')
    expect(preview.text()).toContain('Due 2026-11-02')
    expect(preview.text()).not.toContain('Not in this project')
    expect(preview.find('a').attributes('href')).toBe('https://example.com/repo')
    expect(wrapper.find('.tile-toggle').attributes('aria-expanded')).toBe('true')
  })

  it('toggles once per click on the title button', async () => {
    const wrapper = mountTile()
    await wrapper.find('.tile-toggle').trigger('click')
    expect(wrapper.find('.preview').exists()).toBe(true)
    await wrapper.find('.tile-toggle').trigger('click')
    expect(wrapper.find('.preview').exists()).toBe(false)
  })

  it('emits edit without expanding when Edit is clicked', async () => {
    const wrapper = mountTile()
    const edit = wrapper.findAll('button').find((b) => b.text() === 'Edit')!
    await edit.trigger('click')

    expect(wrapper.emitted('edit')?.[0]).toEqual([project])
    expect(wrapper.find('.preview').exists()).toBe(false)
  })
})
