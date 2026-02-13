import type { Page, Locator } from '@playwright/test'

type CapturedRequest = {
	url: string
	method: string
	postData?: string | null
}

export class Newsletter {
	readonly page: Page
	readonly input: Locator
	readonly consultationButton: Locator
	readonly subscribeButtons: Locator
	readonly successMessage: Locator
	readonly inlineValidationMessage: Locator

	constructor(page: Page) {
		this.page = page
		this.input = page.getByRole('textbox', { name: 'Ваша пошта' }).first()
		this.consultationButton = page.getByRole('button', { name: 'Отримати консультацію' }).first()
		this.subscribeButtons = page.getByRole('button', { name: 'Отримати консультацію' })
		this.successMessage = page.locator('text=/Email успішно надіслано|успішно|success/i').first()
		this.inlineValidationMessage = page.locator('text=/поле обов|не може|помилка|недійсн/i').first()
	}

	async findNearestSubscribeButton(): Promise<Locator | null> {
		const buttons = await this.subscribeButtons.all()
		const boxes = await Promise.all(buttons.map(button => button.boundingBox().catch(() => null)))
		const inputBox = await this.input.boundingBox().catch(() => null)

		if (!inputBox) return null

		let nearestIdx = -1
		let minDist = Infinity

		for (let i = 0; i < boxes.length; i++) {
			const box = boxes[i]
			if (!box) continue

			const dx = box.x + box.width / 2 - (inputBox.x + inputBox.width / 2)
			const dy = box.y + box.height / 2 - (inputBox.y + inputBox.height / 2)
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

	clearCapturedRequests() {
		const capturedRequests = this.getCapturedRequests()
		if (!capturedRequests) return
		capturedRequests.length = 0
	}

	async getNativeValidationMessage(): Promise<string> {
		return this.input.evaluate(el => (el as HTMLInputElement).validationMessage || '')
	}

	async hasInlineValidationMessage(): Promise<boolean> {
		return (await this.inlineValidationMessage.count()) > 0
	}

	async hasValidationSignal(): Promise<boolean> {
		const [nativeValidationMessage, hasInlineValidationMessage] = await Promise.all([
			this.getNativeValidationMessage(),
			this.hasInlineValidationMessage(),
		])
		return nativeValidationMessage.length > 0 || hasInlineValidationMessage
	}

	async focusInputViaKeyboard(maxTabs = 20): Promise<boolean> {
		await this.consultationButton.focus()

		for (let i = 0; i < maxTabs; i++) {
			await this.page.keyboard.press('Tab')
			const isFocused = await this.input.evaluate(el => el === document.activeElement)
			if (isFocused) return true
		}

		return false
	}

	async submitNearest(timeout = 3000) {
		const button = await this.findNearestSubscribeButton()
		if (!button) throw new Error('Кнопку підписки не знайдено')

		await button.click()

		const capturedRequests = this.getCapturedRequests()
		if (!capturedRequests) return null

		const start = Date.now()
		while (Date.now() - start < timeout) {
			if (capturedRequests.length > 0) return capturedRequests.shift() ?? null
			await new Promise(r => setTimeout(r, 120))
		}

		return null
	}

	private getCapturedRequests(): CapturedRequest[] | null {
		if (!(this.page as any)._capturedRequests) return null
		return ((this.page as any)._capturedRequests() as CapturedRequest[]) ?? null
	}
}
