import { describe, it, expect } from 'vitest'

import { mount } from '@vue/test-utils'
import ProjectTile from '../components/projectTile.vue'
import { createEmptyProject, type Project } from '../types/project'
import type { Tag } from '../types/tag'
import { createEmptyTask, type Task } from '../types/task'
import { memoryRouter } from './helpers'

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

const mountTile = (props: { tags?: Tag[]; expanded?: boolean } = {}) =>
  mount(ProjectTile, { props: { project, tasks, tags: [], ...props }, global: { plugins: [memoryRouter()] } })

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
    expect(preview.find('a[target="_blank"]').attributes('href')).toBe('https://example.com/repo')
    expect(preview.find('.timeline').text()).toContain('Review slides')
    expect(wrapper.find('.tile-toggle').attributes('aria-expanded')).toBe('true')
  })

  it('toggles once per click on the title button', async () => {
    const wrapper = mountTile()
    await wrapper.find('.tile-toggle').trigger('click')
    expect(wrapper.find('.preview').exists()).toBe(true)
    await wrapper.find('.tile-toggle').trigger('click')
    expect(wrapper.find('.preview').exists()).toBe(false)
  })

  it('opens and closes with its expanded prop, and asks to change it when toggled', async () => {
    const wrapper = mountTile({ expanded: true })
    expect(wrapper.find('.preview').exists()).toBe(true)

    await wrapper.find('.tile-toggle').trigger('click')
    expect(wrapper.emitted('update:expanded')).toEqual([[false]])

    await wrapper.setProps({ expanded: false })
    expect(wrapper.find('.preview').exists()).toBe(false)
  })

  it("shows each of the project's tags in its colour", () => {
    expect(mountTile().find('.project-tag').exists()).toBe(false)
    const tagged = mountTile({ tags: [{ id: 'school', name: 'School (SUTD)', color: '#17646a' }, { id: 'archive', name: 'Archive', color: '#f5d76e' }] })
    expect(tagged.findAll('.project-tag').map((t) => [t.text(), t.attributes('style')])).toEqual([
      ['School (SUTD)', '--pam-tag-fill: #17646a; --pam-tag-text: #faefe0;'],
      ['Archive', '--pam-tag-fill: #f5d76e; --pam-tag-text: #204030;'],
    ])
  })

  it("links each task to its page, without collapsing the tile when one is clicked", async () => {
    const wrapper = mountTile()
    await wrapper.find('article').trigger('click')

    const links = wrapper.findAll('.preview .task .task-name')
    expect(links.map((a) => [a.text(), a.attributes('href')])).toEqual([
      ['Write report (completed)', '/tasks/t1'],
      ['Review slides', '/tasks/t2'],
    ])
    await links[1]!.trigger('click')
    expect(wrapper.find('.preview').exists()).toBe(true)
  })

  it('links to the project page from View more, without expanding', async () => {
    const wrapper = mountTile()
    const viewMore = wrapper.find('a[aria-label="View more of Thesis"]')
    expect(viewMore.text()).toBe('View more')
    expect(viewMore.attributes('href')).toBe('/projects/p1')

    await viewMore.trigger('click')
    expect(wrapper.find('.preview').exists()).toBe(false)
  })

  it("emits editTask from a task's Edit button, without collapsing the tile", async () => {
    const wrapper = mountTile()
    await wrapper.find('article').trigger('click')
    await wrapper.find('button[aria-label="Edit task Review slides"]').trigger('click')

    expect(wrapper.emitted('editTask')).toEqual([[tasks[1]]])
    expect(wrapper.find('.preview').exists()).toBe(true)
  })

  it("emits toggleTask from a task's check mark, without collapsing the tile", async () => {
    const wrapper = mountTile()
    await wrapper.find('article').trigger('click')

    const checks = wrapper.findAll('.preview .task .check')
    expect(checks.map((c) => [c.attributes('aria-label'), c.attributes('aria-pressed')])).toEqual([
      ['Done: Write report', 'true'],
      ['Done: Review slides', 'false'],
    ])
    await checks[1]!.trigger('click')

    expect(wrapper.emitted('toggleTask')).toEqual([[tasks[1]]])
    expect(wrapper.find('.preview').exists()).toBe(true)
  })

  it('emits edit without expanding when Edit is clicked', async () => {
    const wrapper = mountTile()
    const edit = wrapper.findAll('button').find((b) => b.text() === 'Edit')!
    await edit.trigger('click')

    expect(wrapper.emitted('edit')?.[0]).toEqual([project])
    expect(wrapper.find('.preview').exists()).toBe(false)
  })
})
