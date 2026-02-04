import type { Page, Locator } from '@playwright/test'

export class Newsletter {
	readonly page: Page
	readonly input: Locator
	readonly subscribeButtons: Locator

	constructor(page: Page) {
		this.page = page
		this.input = page.getByRole('textbox', { name: 'Ваша пошта' }).first()
		this.subscribeButtons = page.getByRole('button', { name: 'Отримати консультацію' })
	}

	async findNearestSubscribeButton(): Promise<Locator | null> {
		const buttons: Locator[] = await this.subscribeButtons.all()
		const boxes = await Promise.all(buttons.map(async b => await b.boundingBox().catch(() => null)))
		const inputBox = await this.input.boundingBox().catch(() => null)
		if (!inputBox) return null
		let nearestIdx = -1
		let minDist = Infinity
		for (let i = 0; i < boxes.length; i++) {
			const b = boxes[i]
			if (!b) continue
			const dx = b.x + b.width / 2 - (inputBox.x + inputBox.width / 2)
			const dy = b.y + b.height / 2 - (inputBox.y + inputBox.height / 2)
			const dist = Math.hypot(dx, dy)
			if (dist < minDist) {
				minDist = dist
				nearestIdx = i
			}
		}
		return nearestIdx === -1 ? null : this.subscribeButtons.nth(nearestIdx)
	}

	async fill(email: string) {
		await this.input.fill('')
		await this.input.fill(email)
	}

	async submitNearest(timeout = 3000) {
		const btn = await this.findNearestSubscribeButton()
		if (!btn) throw new Error('Кнопку підписки не знайдено')
		await btn.click()
		// Wait for request captured by our page.route handler if present
		const start = Date.now()
		while (Date.now() - start < timeout) {
			const arr = (this.page as any)._capturedRequests ? (this.page as any)._capturedRequests()! : []
			if (arr.length > 0) return arr.shift()
			await new Promise(r => setTimeout(r, 120))
		}
		return null
	}
}
