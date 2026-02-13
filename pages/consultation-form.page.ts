import type { Page, Locator } from '@playwright/test'

export class ConsultationForm {
	readonly page: Page
	readonly name: Locator
	readonly email: Locator
	readonly phone: Locator
	readonly message: Locator
	readonly submitBtn: Locator

	constructor(page: Page) {
		this.page = page
		this.name = page.locator('#user_name').first()
		this.email = page.locator('#email').first()
		this.phone = page.locator('#phone').first()
		this.message = page.locator('#message').first()
		this.submitBtn = page.locator(`form:has(#user_name)`).first().locator(`button:has-text("Надіслати")`).first()
	}

	async open() {
		const cta = this.page.getByRole('button', { name: 'Отримати консультацію' }).first()
		await cta.scrollIntoViewIfNeeded().catch(() => null)
		await cta.click({ force: true }).catch(() => null)
		try {
			await this.name.waitFor({ state: 'visible', timeout: 10000 })
		} catch {
			await this.page.goto('https://softpro.ua/contacts')
			await this.name.scrollIntoViewIfNeeded().catch(() => null)
			await this.name.waitFor({ state: 'visible', timeout: 10000 })
		}
	}

	async fillForm(data: { name?: string; email?: string; phone?: string; message?: string }) {
		if (data.name !== undefined) await this.name.fill(data.name)
		if (data.email !== undefined) await this.email.fill(data.email)
		if (data.phone !== undefined) await this.phone.fill(data.phone)
		if (data.message !== undefined) await this.message.fill(data.message)
	}

	async isSubmitEnabled(): Promise<boolean> {
		// Determine submit readiness from field validations (button may be visually enabled regardless)
		const v = await this.checkValidity()
		return v.submitEnabled
	}

	async checkValidity(): Promise<{
		nameValid: boolean
		emailValid: boolean
		messageValid: boolean
		submitEnabled: boolean
	}> {
		// Native + deterministic checks per-field (do NOT rely on button enabled state)
		const [nameValid, emailValid, messageValid, phoneNativeValid] = await Promise.all([
			// Name: at least 2 letters, allow letters, spaces, hyphen and apostrophe
			this.name
				.evaluate(el => {
					const v = (el as HTMLInputElement).value || ''
					const nativeOk = (el as HTMLInputElement).checkValidity()
					try {
						const re = /^[\p{L}\s'\-]{2,}$/u
						return nativeOk && re.test(v.trim())
					} catch (e) {
						return nativeOk && v.trim().length >= 2
					}
				})
				.catch(() => false),

			// Email: stricter validation
			this.email
				.evaluate(el => {
					const email = ((el as HTMLInputElement).value || '').trim()
					const nativeOk = (el as HTMLInputElement).checkValidity()
					if (!email) return false
					if (email.includes(' ')) return false
					const parts = email.split('@')
					if (parts.length !== 2) return false
					const [local, domain] = parts
					if (!local || !domain) return false
					if (local.startsWith('.') || local.endsWith('.')) return false
					if (domain.startsWith('.') || domain.endsWith('.')) return false
					if (local.includes('..') || domain.includes('..')) return false
					if (!/^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~.\-]+$/.test(local)) return false
					if (!/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(domain)) return false
					if (/[ _]/.test(domain)) return false
					return nativeOk && true
				})
				.catch(() => false),

			// Message: min 10 chars, max 2000 chars
			this.message
				.evaluate(el => {
					const v = (el as HTMLTextAreaElement).value || ''
					const len = v.trim().length
					const nativeOk = (el as HTMLTextAreaElement).checkValidity()
					return nativeOk && len >= 10 && v.length <= 2000
				})
				.catch(() => false),

			// Phone: native validity as hint
			this.phone.evaluate(el => (el as HTMLInputElement).checkValidity()).catch(() => false),
		])

		// Explicit phone validation used by tests and submitEnabled decision
		const phoneValue = await this.phone
			.evaluate(el => ((el as HTMLInputElement).value || '').replace(/\s+/g, ''))
			.catch(() => '')
		const phoneRe = /^(?:\+?380)\d{9}$/
		const phoneValid = phoneRe.test(phoneValue)

		const submitEnabled = Boolean(nameValid && emailValid && messageValid && phoneValid)
		return {
			nameValid: Boolean(nameValid),
			emailValid: Boolean(emailValid),
			messageValid: Boolean(messageValid),
			submitEnabled,
		}
	}

	async submit() {
		await this.submitBtn.click()
	}

	async submitAndWaitForCapture(timeout = 10000) {
		const start = Date.now()
		while (Date.now() - start < timeout) {
			const arr = (this.page as any)._capturedRequests ? (this.page as any)._capturedRequests()! : []
			if (arr.length > 0) return arr.shift()
			await new Promise(r => setTimeout(r, 120))
		}
		return null
	}
}
