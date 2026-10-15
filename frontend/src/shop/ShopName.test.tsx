import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ShopName } from './ShopName'

it('sets the "of" in the middle of the name in italic', () => {
  render(<p>{<ShopName name="Bundle of Loops" />}</p>)
  expect(screen.getByText('of').tagName).toBe('EM')
  expect(screen.getByText('of').className).toContain('text-terracotta')
  expect(document.body).toHaveTextContent('Bundle of Loops')
})

it('shows other names plainly, including ones where "of" is part of a word', () => {
  render(<p>{<ShopName name="Offbeat Crochet" />}</p>)
  expect(document.querySelector('em')).toBeNull()
  expect(document.body).toHaveTextContent('Offbeat Crochet')
})

it('handles a longer name using only the first " of "', () => {
  render(<p>{<ShopName name="House of Yarn of Lahore" />}</p>)
  expect(document.querySelectorAll('em')).toHaveLength(1)
  expect(document.body).toHaveTextContent('House of Yarn of Lahore')
})
