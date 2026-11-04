import { extensionFor } from './file-extension'

describe('extensionFor', () => {
    // A stored .html or .svg is served from the API's origin: stored XSS.
    it('names a stored file after its checked type, and anything a browser would render as .bin', () => {
        expect(extensionFor('image/png')).toBe('png')
        expect(extensionFor('text/html')).toBe('bin')
        expect(extensionFor('image/svg+xml')).toBe('bin')
    })
})
