import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { expectNoA11yViolations } from './a11y'

it('the checker really catches problems (so a green result means something)', async () => {
  const { container } = render(
    <main>
      <img src="x.jpg" />
      <button />
      <input />
      <h1>Title</h1>
      <h4>Skipped levels</h4>
    </main>,
  )
  await expect(expectNoA11yViolations(container)).rejects.toThrow(/image-alt|button-name|label/)
})

it('and passes clean markup', async () => {
  const { container } = render(
    <main>
      <h1>Title</h1>
      <label htmlFor="n">Name</label>
      <input id="n" />
      <button type="button">Save</button>
    </main>,
  )
  await expectNoA11yViolations(container)
})
